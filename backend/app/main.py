"""Single-user, loopback-only development API. Run one worker, without reload."""
import json
import logging
from typing import Annotated
from uuid import UUID

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from .config import Settings
from .diagnostics import diagnose
from .errors import TryOnError
from .schemas import Category, TryOnOptions
from .service import ARTIFACTS, TryOnService

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, service: TryOnService | None = None) -> FastAPI:
    settings = settings or Settings()
    service = service or TryOnService(settings)
    app = FastAPI(title="FORM local try-on API", version="0.1.0",
                  description="Phase 1: one person and one upper-body garment. Local development only; inference needs CUDA and separately installed model weights.")
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]"])
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins),
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.middleware("http")
    async def local_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin is not None and origin not in settings.allowed_origins:
            return JSONResponse({"error": {"code": "origin_denied", "message": "This local API only accepts the local application."}}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(TryOnError)
    async def expected_error(request: Request, error: TryOnError):
        return JSONResponse({"error": {"code": error.code, "message": str(error)}}, status_code=error.status)

    @app.get("/health")
    def health():
        return {"status": "ok", "scope": "local-single-user", "enabled_categories": ["upper"],
                "verification_scope": "api-only", "model_loading": "per-request",
                "note": "API health does not verify GPU inference. Models load per request."}

    @app.get("/diagnostics")
    def diagnostics():
        return diagnose(settings)

    @app.post("/v1/try-on")
    async def try_on(person: Annotated[UploadFile, File()], garment: Annotated[UploadFile, File()],
                     category: Annotated[Category, Form()] = Category.upper,
                     quality: Annotated[str, Form()] = "preview",
                     steps: Annotated[int, Form()] = 30, seed: Annotated[int, Form()] = 42,
                     guidance: Annotated[float, Form()] = 2.5,
                     garment_background: Annotated[str, Form()] = "plain"):
        try:
            try:
                options = TryOnOptions(category=category, quality=quality, steps=steps, seed=seed,
                                       guidance=guidance, garment_background=garment_background)
            except ValidationError as error:
                raise TryOnError("invalid_options", error.errors()[0]["msg"]) from error
            limit = settings.max_upload_bytes
            person_bytes = await person.read(limit + 1)
            garment_bytes = await garment.read(limit + 1)
            return await run_in_threadpool(service.run, person_bytes, garment_bytes, options)
        except TryOnError:
            raise
        except Exception as error:
            logger.exception("Try-on failed")
            return JSONResponse({"error": {"code": "inference_failed",
                                          "message": f"{type(error).__name__}: {error}",
                                          "help": "Copy the backend terminal traceback. No fallback image was generated."}}, status_code=500)
        finally:
            await person.close()
            await garment.close()

    @app.get("/v1/runs/{run_id}")
    def report(run_id: UUID):
        path = settings.data_dir / "runs" / str(run_id) / "report.json"
        if not path.is_file():
            raise TryOnError("not_found", "Run not found.", 404)
        return json.loads(path.read_text(encoding="utf-8"))

    @app.get("/v1/runs/{run_id}/{artifact}")
    def artifact(run_id: UUID, artifact: str):
        if artifact not in ARTIFACTS:
            raise TryOnError("not_found", "Artifact not found.", 404)
        path = settings.data_dir / "runs" / str(run_id) / artifact
        if not path.is_file():
            raise TryOnError("not_found", "Artifact not found.", 404)
        return FileResponse(path, media_type="image/png")

    return app


app = create_app()
