import argparse
import json
import sys

from backend.app.config import Settings
from backend.app.diagnostics import diagnose


def main():
    parser = argparse.ArgumentParser(description="Report the actual Python environment and CUDA readiness; downloads no weights.")
    parser.add_argument("--check-imports", action="store_true", help="Also import CatVTON and AutoMasker without loading weights")
    args = parser.parse_args()
    settings = Settings()
    report = diagnose(settings)
    if args.check_imports:
        try:
            from backend.app.models.catvton import import_upstream
            import_upstream(settings)
            report["model_imports"] = "passed"
        except Exception as error:
            report["model_imports"] = f"{type(error).__name__}: {error}"
            report["problems"].append(report["model_imports"])
            report["prerequisites_ready"] = False
    print(json.dumps(report, indent=2))
    return 0 if report["prerequisites_ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
