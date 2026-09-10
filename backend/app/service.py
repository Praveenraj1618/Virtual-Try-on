import json
from pathlib import Path
from threading import Lock
import time
from uuid import uuid4

from PIL import Image

from .config import Settings
from .errors import TryOnError
from .images import Letterbox, composite, decode_image, prepare_garment, rgb_on_white
from .models.catvton import CatVTONAdapter
from .schemas import Category, TryOnOptions

ARTIFACTS = {"person.png", "garment.png", "garment-mask.png", "person-canvas.png",
             "garment-canvas.png", "edit-mask.png", "protected-mask.png", "densepose.png",
             "segmentation.png", "segmentation-atr.png", "generated.png", "result.png", "comparison.png", "alpha.png"}


class TryOnService:
    def __init__(self, settings: Settings, adapter=None):
        self.settings = settings
        self.adapter = adapter if adapter is not None else CatVTONAdapter(settings)
        self.lock = Lock()

    def run(self, person_bytes: bytes, garment_bytes: bytes, options: TryOnOptions) -> dict:
        if options.category != Category.upper:
            raise TryOnError("category_not_enabled", "Phase 1 supports one shirt or T-shirt. Bottoms, dresses and layered outfits are defined for later phases, but are not enabled yet.")
        if not self.lock.acquire(blocking=False):
            raise TryOnError("gpu_busy", "A try-on is already running. Wait for it to finish before starting another.", 409)
        run_dir = None
        started = time.perf_counter()
        try:
            decode_options = {"max_bytes": self.settings.max_upload_bytes, "max_pixels": self.settings.max_pixels}
            person = rgb_on_white(decode_image(person_bytes, **decode_options))
            garment_rgba = decode_image(garment_bytes, **decode_options)
            garment, garment_mask, removal_method = prepare_garment(garment_rgba, options.garment_background)
            transform = Letterbox.for_image(person, options.canvas_size)
            person_canvas = transform.apply(person)
            garment_canvas = Letterbox.for_image(garment, options.canvas_size).apply(garment)
            run_id = str(uuid4())
            run_dir = self.settings.data_dir / "runs" / run_id
            run_dir.mkdir(parents=True)
            self._report(run_dir, {"id": run_id, "status": "running", "options": options.model_dump(mode="json")})
            generated, edit, protected, debug, metadata = self.adapter.generate(person_canvas, garment_canvas, options)
            result, alpha = composite(person, generated, edit, protected, transform)
            images = {"person": person, "garment": garment, "garment-mask": garment_mask,
                      "person-canvas": person_canvas, "garment-canvas": garment_canvas,
                      "generated": generated, "result": result, "edit-mask": edit,
                      "protected-mask": protected, "alpha": alpha, **debug}
            # Use the model canvas size for an affordable comparison image.
            comparison = Image.new("RGB", (options.canvas_size[0]*2, options.canvas_size[1]), "white")
            comparison.paste(person_canvas, (0, 0))
            comparison.paste(transform.apply(result), (options.canvas_size[0], 0))
            images["comparison"] = comparison
            for name, image in images.items():
                if name + ".png" not in ARTIFACTS:
                    raise ValueError("Unrecognized model artifact")
                image.save(run_dir / (name + ".png"))
            report = {"id": run_id, "status": "completed", "options": options.model_dump(mode="json"),
                      "original_size": person.size, "canvas_size": options.canvas_size,
                      "garment_background_method": removal_method,
                      "seconds": round(time.perf_counter()-started, 2), "model": metadata,
                      "result_url": f"/v1/runs/{run_id}/result.png",
                      "comparison_url": f"/v1/runs/{run_id}/comparison.png",
                      "artifacts": sorted(name + ".png" for name in images),
                      "quality_status": "generated_unreviewed",
                      "note": "Review the masks and garment details. A completed inference does not prove identity, cut or fit accuracy."}
            self._report(run_dir, report)
            return report
        except Exception as error:
            if run_dir is not None:
                self._report(run_dir, {"id": run_dir.name, "status": "failed",
                                      "error": {"code": getattr(error, "code", "inference_failed"), "message": str(error)}})
            raise
        finally:
            self.lock.release()

    @staticmethod
    def _report(path: Path, report: dict):
        pending = path / "report.tmp"
        pending.write_text(json.dumps(report, indent=2), encoding="utf-8")
        pending.replace(path / "report.json")
