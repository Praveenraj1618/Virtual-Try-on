"""Adapter for upstream CatVTON, not a reimplementation of its denoising network.

Upstream: https://github.com/Zheng-Chong/CatVTON (CC BY-NC-SA 4.0).
Imports and weights are lazy: the API and image-processing tests run without torch.
"""
import gc
import importlib
import json
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image

from ..config import CATVTON_REVISION, Settings
from ..diagnostics import source_revision
from ..errors import TryOnError
from ..masking import upper_body_masks


def import_upstream(settings: Settings):
    if source_revision(settings) != CATVTON_REVISION:
        raise TryOnError("model_source_missing", "Run python -m backend.scripts.setup_model to install the pinned CatVTON source.", 503)
    root = str(settings.source_dir)
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        pipeline_module = importlib.import_module("model.pipeline")
        masker_module = importlib.import_module("model.cloth_masker")
        for module in [pipeline_module, masker_module]:
            if not Path(module.__file__).resolve().is_relative_to(settings.source_dir):
                raise ImportError("Another package named model shadows CatVTON. Use the isolated vton environment.")
        return pipeline_module.CatVTONPipeline, masker_module.AutoMasker
    except (ImportError, OSError, RuntimeError) as error:
        raise TryOnError("model_dependencies", f"CatVTON import failed: {type(error).__name__}: {error}. Check backend/README.md and the isolated environment.", 503) from error


class CatVTONAdapter:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _runtime(self):
        try:
            import torch
        except (ImportError, OSError) as error:
            raise TryOnError("torch_missing", f"PyTorch could not load: {error}. Install the CUDA wheels in the vton environment.", 503) from error
        if not torch.cuda.is_available():
            raise TryOnError("cuda_unavailable", "CUDA is unavailable. Run python -m backend.scripts.diagnose and check the NVIDIA driver and PyTorch installation.", 503)
        return torch

    def _snapshots(self):
        try:
            manifest = json.loads(self.settings.manifest_path.read_text(encoding="utf-8"))
            for key in ["attention", "base", "vae"]:
                if not Path(manifest[key]["path"]).is_dir():
                    raise ValueError(f"Missing {key} snapshot")
            return manifest
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise TryOnError("weights_missing", "Run python -m backend.scripts.setup_model --download-weights before generating.", 503) from error

    def generate(self, person: Image.Image, garment: Image.Image, options):
        torch = self._runtime()
        snapshots = self._snapshots()
        Pipeline, AutoMasker = import_upstream(self.settings)
        torch.cuda.reset_peak_memory_stats()
        started = time.perf_counter()
        masker = pipeline = None
        try:
            attention_root = snapshots["attention"]["path"]
            masker = AutoMasker(densepose_ckpt=str(Path(attention_root) / "DensePose"),
                                schp_ckpt=str(Path(attention_root) / "SCHP"), device="cuda")
            with torch.inference_mode():
                parsed = masker(person, "upper")
            # Keep indexed labels. Converting palette images to L would corrupt classes.
            lip = np.asarray(parsed["schp_lip"])
            atr = np.asarray(parsed["schp_atr"])
            dense = np.asarray(parsed["densepose"])
            face = (lip == 13) | (atr == 11)
            if face.sum() < 16 or not np.any(dense):
                raise TryOnError("person_not_detected", "Could not identify the face and body clearly. Use one front-facing person with their face visible and arms slightly apart.")
            mask, protected = upper_body_masks(lip, atr, parsed["mask"])
            edit = np.asarray(mask) > 127
            if edit.mean() < .01 or edit.mean() > .80:
                raise TryOnError("person_mask", "The clothing mask is unreliable. Try a clearer photo with the whole upper body visible.")
            mask = Image.fromarray(edit.astype(np.uint8) * 255)
            diagnostics = {"densepose": parsed["densepose"].copy(),
                           "segmentation": parsed["schp_lip"].copy(),
                           "segmentation-atr": parsed["schp_atr"].copy()}
            # Release all three parsing networks before loading the diffusion network.
            del parsed
            masker = None
            gc.collect()
            torch.cuda.empty_cache()
            parsing_seconds = time.perf_counter() - started
            dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16

            class CheckedPipeline(Pipeline):
                def __init__(self):
                    # Initialize upstream's documented components with LOCAL snapshots.
                    # Its regular constructor hardcodes an unpinned online VAE identifier.
                    from diffusers import AutoencoderKL, DDIMScheduler, UNet2DConditionModel
                    from diffusers.pipelines.stable_diffusion.safety_checker import StableDiffusionSafetyChecker
                    from transformers import CLIPImageProcessor
                    from model.attn_processor import SkipAttnProcessor
                    from model.utils import get_trainable_module, init_adapter
                    self.device, self.weight_dtype, self.skip_safety_check = "cuda", dtype, False
                    base = snapshots["base"]["path"]
                    local = {"local_files_only": True}
                    self.noise_scheduler = DDIMScheduler.from_pretrained(base, subfolder="scheduler", **local)
                    self.vae = AutoencoderKL.from_pretrained(snapshots["vae"]["path"], **local).to("cuda", dtype=dtype)
                    self.feature_extractor = CLIPImageProcessor.from_pretrained(base, subfolder="feature_extractor", **local)
                    self.safety_checker = StableDiffusionSafetyChecker.from_pretrained(base, subfolder="safety_checker", **local).to("cuda", dtype=dtype)
                    self.unet = UNet2DConditionModel.from_pretrained(base, subfolder="unet", **local).to("cuda", dtype=dtype)
                    init_adapter(self.unet, cross_attn_cls=SkipAttnProcessor)
                    self.attn_modules = get_trainable_module(self.unet, "attention")
                    self.auto_attn_ckpt_load(attention_root, "mix")
                    torch.set_float32_matmul_precision("high")
                    torch.backends.cuda.matmul.allow_tf32 = True

                def run_safety_checker(self, image):
                    checked, flags = super().run_safety_checker(image)
                    if flags is not None and any(flags):
                        raise TryOnError("generation_filtered", "The model filtered this generation. Try a different seed or garment photo.")
                    return checked, flags

            pipeline = CheckedPipeline()
            pipeline.vae.enable_slicing()
            pipeline.vae.enable_tiling()
            generator = torch.Generator(device="cuda").manual_seed(options.seed)
            width, height = person.size
            with torch.inference_mode():
                generated = pipeline(image=person, condition_image=garment, mask=mask,
                                     width=width, height=height, generator=generator,
                                     num_inference_steps=options.steps, guidance_scale=options.guidance)[0]
            torch.cuda.synchronize()
            metadata = {"model": "CatVTON", "source_revision": CATVTON_REVISION,
                        "weight_snapshots": snapshots, "precision": str(dtype),
                        "gpu": torch.cuda.get_device_name(0),
                        "peak_allocated_vram_mib": round(torch.cuda.max_memory_allocated() / 2**20),
                        "peak_reserved_vram_mib": round(torch.cuda.max_memory_reserved() / 2**20),
                        "parsing_seconds": round(parsing_seconds, 2),
                        "model_seconds": round(time.perf_counter()-started, 2)}
            return generated, mask, protected, diagnostics, metadata
        except torch.cuda.OutOfMemoryError as error:
            raise TryOnError("gpu_out_of_memory", "The GPU ran out of memory. Use preview quality, close other GPU applications and retry. Include the diagnostics output when reporting this error.", 503) from error
        finally:
            masker = pipeline = None
            gc.collect()
            torch.cuda.empty_cache()
