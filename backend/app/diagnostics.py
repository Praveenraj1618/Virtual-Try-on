import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import sys

from .config import CATVTON_REVISION, Settings


def source_revision(settings: Settings) -> str | None:
    if not (settings.source_dir / ".git").exists():
        return None
    try:
        return subprocess.check_output(
            ["git", "-C", str(settings.source_dir), "rev-parse", "HEAD"],
            text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
    except (OSError, subprocess.SubprocessError):
        return None


def diagnose(settings: Settings) -> dict:
    report = {"python": platform.python_version(), "executable": sys.executable,
              "platform": platform.platform(), "packages": {}, "cuda_available": False,
              "gpus": [], "problems": [], "model_source_revision": source_revision(settings),
              "expected_source_revision": CATVTON_REVISION,
              "inference_verified": False}
    packages = {"torch": "2.4.0", "torchvision": "0.19.0", "diffusers": "0.31.0",
                "transformers": "4.46.3", "accelerate": "0.31.0",
                "huggingface-hub": "0.25.2", "peft": "0.13.2"}
    for name, expected in packages.items():
        try:
            installed = importlib.metadata.version(name)
            report["packages"][name] = installed
            if installed.split("+")[0] != expected:
                report["problems"].append(f"{name}: expected {expected}, found {installed}.")
        except importlib.metadata.PackageNotFoundError:
            report["packages"][name] = None
            report["problems"].append(f"{name} is not installed in this Python environment.")
    try:
        import torch
        report["torch_cuda_runtime"] = torch.version.cuda
        report["cuda_available"] = torch.cuda.is_available()
        if report["cuda_available"]:
            for index in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(index)
                report["gpus"].append({"index": index, "name": props.name,
                                       "total_vram_mib": round(props.total_memory / 2**20)})
            report["bf16_supported"] = torch.cuda.is_bf16_supported()
        else:
            report["problems"].append("CUDA is unavailable. Check the NVIDIA driver and CUDA-enabled PyTorch wheel.")
    except Exception as error:
        report["problems"].append(f"PyTorch could not load: {type(error).__name__}: {error}")
    if report["model_source_revision"] != CATVTON_REVISION:
        report["problems"].append("Pinned CatVTON source is missing or different. Run python -m backend.scripts.setup_model.")
    try:
        manifest = json.loads(settings.manifest_path.read_text(encoding="utf-8"))
        report["weights_downloaded"] = all(Path(manifest[k]["path"]).is_dir()
                                            for k in ["base", "attention", "vae"])
    except (OSError, ValueError, KeyError, TypeError):
        report["weights_downloaded"] = False
    if not report["weights_downloaded"]:
        report["problems"].append("Model snapshots are not prepared. Run setup_model --download-weights after CUDA works.")
    report["prerequisites_ready"] = not report["problems"]
    report["note"] = "Prerequisites do not prove model import compatibility, inference success or visual quality. Run the smoke test."
    return report
