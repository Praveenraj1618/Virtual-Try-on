import argparse
import json
from pathlib import Path
import sys

from backend.app.config import Settings
from backend.app.errors import TryOnError
from backend.app.schemas import TryOnOptions
from backend.app.service import TryOnService


def main():
    parser = argparse.ArgumentParser(description="Run one real CUDA try-on and save diagnostic artifacts.")
    parser.add_argument("--person", type=Path, required=True)
    parser.add_argument("--garment", type=Path, required=True)
    parser.add_argument("--quality", choices=["preview", "detail"], default="preview")
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--garment-background", choices=["plain", "keep"], default="plain")
    args = parser.parse_args()
    settings = Settings()
    options = TryOnOptions(quality=args.quality, steps=args.steps, seed=args.seed,
                           garment_background=args.garment_background)
    def read(path):
        with path.open("rb") as stream:
            return stream.read(settings.max_upload_bytes + 1)
    try:
        report = TryOnService(settings).run(read(args.person), read(args.garment), options)
    except TryOnError as error:
        print(json.dumps({"error": {"code": error.code, "message": str(error)}}, indent=2))
        return 1
    print(json.dumps(report, indent=2))
    print(f"Inspect images and report in: {settings.data_dir / 'runs' / report['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
