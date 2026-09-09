"""Settings never import torch or start a model download."""
from dataclasses import dataclass, field
from pathlib import Path
import os

BACKEND_ROOT = Path(__file__).resolve().parents[1]
CATVTON_REVISION = "7818397f25613beedb3d861a34769f607cfcf3b1"
CATVTON_REPOSITORY = "https://github.com/Zheng-Chong/CatVTON.git"
BASE_MODEL = "stable-diffusion-v1-5/stable-diffusion-inpainting"
ATTENTION_MODEL = "zhengchong/CatVTON"
VAE_MODEL = "stabilityai/sd-vae-ft-mse"


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get(
        "VTON_DATA_DIR", str(BACKEND_ROOT / "data"))).resolve())
    source_dir: Path = field(default_factory=lambda: Path(os.environ.get(
        "CATVTON_ROOT", str(BACKEND_ROOT / "external" / "CatVTON"))).resolve())
    max_upload_bytes: int = 10 * 1024 * 1024
    max_pixels: int = 16_000_000
    allowed_origins: tuple[str, ...] = (
        "http://127.0.0.1:5173", "http://localhost:5173",
        "http://127.0.0.1:8000", "http://localhost:8000",
    )

    @property
    def manifest_path(self) -> Path:
        return self.data_dir / "model-install.json"
