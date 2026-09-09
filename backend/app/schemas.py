from enum import Enum
from pydantic import BaseModel, ConfigDict, Field


class Category(str, Enum):
    upper = "upper"
    lower = "lower"
    dress = "dress"
    outerwear = "outerwear"


class TryOnOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Category = Category.upper
    quality: str = Field(default="preview", pattern="^(preview|detail)$")
    steps: int = Field(default=30, ge=10, le=60)
    seed: int = Field(default=42, ge=0, le=2**32 - 1)
    guidance: float = Field(default=2.5, ge=1, le=5)
    garment_background: str = Field(default="plain", pattern="^(plain|keep)$")

    @property
    def canvas_size(self) -> tuple[int, int]:
        return (576, 768) if self.quality == "preview" else (768, 1024)
