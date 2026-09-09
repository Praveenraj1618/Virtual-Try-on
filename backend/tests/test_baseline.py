"""CPU tests. Synthetic model output is only injected here, never exposed as a backend mode."""
from io import BytesIO
import json

import numpy as np
from PIL import Image, ImageDraw
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.errors import TryOnError
from backend.app.images import Letterbox, composite, decode_image, prepare_garment
from backend.app.main import create_app
from backend.app.schemas import Category, TryOnOptions
from backend.app.service import TryOnService


def png(image):
    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def photos():
    person = Image.new("RGB", (300, 480), "#ababab")
    ImageDraw.Draw(person).rectangle((100, 10, 200, 90), fill="#c08650")
    garment = Image.new("RGB", (240, 320), "white")
    ImageDraw.Draw(garment).rectangle((40, 35, 200, 285), fill="#2050a0")
    return png(person), png(garment)


def decode(data):
    return decode_image(data, max_bytes=10*1024*1024, max_pixels=16_000_000)


def test_decode_rejects_nonimages_and_applies_exif():
    with pytest.raises(TryOnError, match="decoded"):
        decode(b"not an image")
    image = Image.new("RGB", (128, 256), "red")
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "Private image description"
    stream = BytesIO()
    image.save(stream, "JPEG", exif=exif)
    decoded = decode(stream.getvalue())
    assert decoded.size == (256, 128)
    assert not decoded.info
    assert not decoded.getexif()


def test_decode_checks_byte_and_pixel_limits():
    data = photos()[0]
    with pytest.raises(TryOnError) as error:
        decode_image(data, max_bytes=3, max_pixels=16_000_000)
    assert error.value.status == 413
    with pytest.raises(TryOnError) as error:
        decode_image(data, max_bytes=100000, max_pixels=100)
    assert error.value.status == 413


@pytest.mark.parametrize("size", [(300, 600), (600, 300), (333, 777)])
def test_letterbox_preserves_geometry_without_cropping(size):
    image = Image.new("RGB", size, "red")
    transform = Letterbox.for_image(image, (576, 768))
    canvas = transform.apply(image)
    restored = transform.restore(canvas)
    assert restored.size == size
    assert np.all(np.asarray(restored) == [255, 0, 0])
    x, y, x2, y2 = transform.box
    assert abs((x2-x)/(y2-y) - size[0]/size[1]) < .01
    with pytest.raises(TryOnError, match="dimensions"):
        transform.apply(Image.new("L", (13, 13)), mask=True)


def test_transparent_garment_preserves_visible_colour():
    image = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    ImageDraw.Draw(image).rectangle((50, 50, 150, 150), fill=(20, 30, 40, 255))
    clean, mask, method = prepare_garment(image, "plain")
    assert method == "provided_transparency"
    assert mask.getpixel((0, 0)) == 0
    assert clean.getpixel((100, 100)) == (20, 30, 40)
    assert clean.getpixel((0, 0)) == (255, 255, 255)


def test_plain_background_removal_retains_white_pattern_inside_garment():
    image = decode(photos()[1])
    ImageDraw.Draw(image).rectangle((90, 90, 130, 130), fill="white")
    clean, mask, method = prepare_garment(image, "plain")
    assert mask.getpixel((0, 0)) == 0
    assert mask.getpixel((100, 100)) == 255
    assert clean.getpixel((50, 50)) == (32, 80, 160)


def test_transparent_edges_are_composited_only_once():
    image = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    ImageDraw.Draw(image).rectangle((50, 50, 150, 150), fill=(0, 0, 0, 128))
    clean, mask, _ = prepare_garment(image, "plain")
    assert clean.getpixel((100, 100)) == (127, 127, 127)


def test_blank_garment_is_rejected():
    with pytest.raises(TryOnError, match="separate"):
        prepare_garment(Image.new("RGB", (200, 200), "white"), "plain")


def test_compositing_preserves_exact_face_and_background_pixels():
    rng = np.random.default_rng(10)
    person = Image.fromarray(rng.integers(0, 256, (480, 300, 3), dtype=np.uint8))
    transform = Letterbox.for_image(person, (576, 768))
    edit = Image.new("L", transform.canvas_size, 0)
    ImageDraw.Draw(edit).rectangle((180, 50, 380, 550), fill=255)
    protected = Image.new("L", transform.canvas_size, 0)
    ImageDraw.Draw(protected).rectangle((230, 50, 330, 190), fill=255)
    generated = Image.new("RGB", transform.canvas_size, "red")
    result, alpha = composite(person, generated, edit, protected, transform)
    before, after = np.asarray(person), np.asarray(result)
    face = np.asarray(transform.restore(protected, mask=True)) > 0
    unchanged = np.asarray(alpha) == 0
    assert np.array_equal(before[face], after[face])
    assert np.array_equal(before[unchanged], after[unchanged])
    assert np.any(np.asarray(alpha) == 255)
    assert np.any(before[~unchanged] != after[~unchanged])


class SyntheticAdapter:
    def generate(self, person, garment, options):
        edit = Image.new("L", person.size, 0)
        ImageDraw.Draw(edit).rectangle((150, 200, 430, 600), fill=255)
        return (Image.new("RGB", person.size, "blue"), edit,
                Image.new("L", person.size, 0), {}, {"test_double": True})


def test_service_persists_original_size_result_and_options(tmp_path):
    settings = Settings(data_dir=tmp_path)
    service = TryOnService(settings, SyntheticAdapter())
    report = service.run(*photos(), TryOnOptions(seed=24))
    run_dir = tmp_path / "runs" / report["id"]
    assert report["status"] == "completed"
    assert report["options"]["seed"] == 24
    assert report["quality_status"] == "generated_unreviewed"
    assert Image.open(run_dir / "result.png").size == (300, 480)
    assert json.loads((run_dir / "report.json").read_text())["id"] == report["id"]


def test_busy_service_rejects_parallel_request(tmp_path):
    service = TryOnService(Settings(data_dir=tmp_path), SyntheticAdapter())
    service.lock.acquire()
    try:
        with pytest.raises(TryOnError) as error:
            service.run(*photos(), TryOnOptions())
        assert error.value.code == "gpu_busy"
        assert error.value.status == 409
    finally:
        service.lock.release()


def test_gpu_error_never_produces_fake_result_and_lock_is_released(tmp_path):
    class Failing:
        def generate(self, *args):
            raise TryOnError("cuda_unavailable", "CUDA unavailable", 503)
    service = TryOnService(Settings(data_dir=tmp_path), Failing())
    with pytest.raises(TryOnError):
        service.run(*photos(), TryOnOptions())
    assert not service.lock.locked()
    report = json.loads(next(tmp_path.glob("runs/*/report.json")).read_text())
    assert report["status"] == "failed"
    assert not list(tmp_path.glob("runs/*/result.png"))


@pytest.fixture
def client(tmp_path):
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings, TryOnService(settings, SyntheticAdapter())), base_url="http://localhost:8000") as client:
        yield client


def upload(client, **data):
    person, garment = photos()
    return client.post("/v1/try-on", files={"person": ("person.png", person, "image/png"),
                                          "garment": ("shirt.png", garment, "image/png")}, data=data)


def test_api_health_does_not_claim_model_success(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["verification_scope"] == "api-only"
    assert response.json()["enabled_categories"] == ["upper"]


def test_api_upload_download_and_report(client):
    response = upload(client)
    assert response.status_code == 200, response.text
    report = response.json()
    result = client.get(report["result_url"])
    assert result.headers["content-type"] == "image/png"
    assert result.headers["cache-control"] == "no-store"
    assert Image.open(BytesIO(result.content)).size == (300, 480)
    assert client.get(f"/v1/runs/{report['id']}").json()["status"] == "completed"
    assert client.get(f"/v1/runs/{report['id']}/model-install.json").status_code == 404
    assert client.get("/v1/runs/not-a-uuid/result.png").status_code == 422


@pytest.mark.parametrize("category", [Category.lower, Category.dress, Category.outerwear])
def test_unimplemented_categories_are_explicitly_rejected(client, category):
    response = upload(client, category=category.value)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "category_not_enabled"


def test_api_options_are_validated(client):
    assert upload(client, steps="999").status_code == 422
    assert upload(client, quality="huge").status_code == 422
    assert upload(client, category="hat").status_code == 422


def test_local_api_rejects_external_origins_and_hosts(client):
    assert client.get("/health", headers={"origin": "https://example.com"}).status_code == 403
    assert client.get("/health", headers={"host": "evil.example"}).status_code == 400


def test_real_adapter_reports_missing_cuda_without_generating(tmp_path, monkeypatch):
    # Exercise the real failure path without importing or installing GPU weights.
    import sys
    from types import SimpleNamespace
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)))
    service = TryOnService(Settings(data_dir=tmp_path))
    with pytest.raises(TryOnError) as error:
        service.run(*photos(), TryOnOptions())
    assert error.value.code == "cuda_unavailable"
    assert not list(tmp_path.glob("runs/*/result.png"))
