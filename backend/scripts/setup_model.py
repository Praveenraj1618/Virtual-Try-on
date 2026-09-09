"""Install upstream source and, only when requested, download official weights."""
import argparse
import json
from pathlib import Path
import subprocess

from backend.app.config import (ATTENTION_MODEL, BASE_MODEL, CATVTON_REPOSITORY,
                                CATVTON_REVISION, Settings, VAE_MODEL)
from backend.app.diagnostics import source_revision


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download-weights", action="store_true", help="Downloads several GB from Hugging Face; images are never uploaded")
    args = parser.parse_args()
    settings = Settings()
    if not settings.source_dir.exists():
        settings.source_dir.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--filter=blob:none", "--no-checkout",
                        CATVTON_REPOSITORY, str(settings.source_dir)], check=True)
        subprocess.run(["git", "-C", str(settings.source_dir), "checkout", "--detach", CATVTON_REVISION], check=True)
    if source_revision(settings) != CATVTON_REVISION:
        raise SystemExit("CatVTON source already exists at another revision. It was not overwritten. Set CATVTON_ROOT to a new empty directory and rerun.")
    print(f"CatVTON source ready: {settings.source_dir}\nRevision: {CATVTON_REVISION}")
    if not args.download_weights:
        print("Weights were not downloaded. First verify CUDA, then rerun with --download-weights.")
        return
    import torch
    if not torch.cuda.is_available():
        raise SystemExit("CUDA is unavailable. Fix the driver/PyTorch setup before downloading weights.")
    from huggingface_hub import snapshot_download
    # Snapshot paths record the exact resolved revisions, so subsequent runs reuse them.
    manifest = {}
    if settings.manifest_path.is_file():
        manifest = json.loads(settings.manifest_path.read_text(encoding="utf-8"))
    specs = {
        "attention": (ATTENTION_MODEL, ["mix-48k-1024/attention/*", "DensePose/*", "SCHP/*"]),
        "base": (BASE_MODEL, ["unet/*", "scheduler/*", "feature_extractor/*", "safety_checker/*"]),
        # CatVTON's constructor uses this repository identifier internally.
        "vae": (VAE_MODEL, ["config.json", "diffusion_pytorch_model.*"]),
    }
    for name, (repo_id, patterns) in specs.items():
        old = manifest.get(name, {})
        if old.get("repo") == repo_id and Path(old.get("path", "missing")).is_dir():
            print(f"Reusing {name} snapshot: {old.get('revision')}")
            continue
        print(f"Downloading {repo_id} ...")
        path = Path(snapshot_download(repo_id, allow_patterns=patterns,
                                     ignore_patterns=["*.onnx", "*.msgpack", "*.fp16.*"], max_workers=2))
        manifest[name] = {"repo": repo_id, "path": str(path.resolve()), "revision": path.name}
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Snapshots prepared. Run diagnose --check-imports, then smoke_test with your own images.")


if __name__ == "__main__":
    main()
