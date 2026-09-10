# Phase 1: local person-based AI try-on

This adds a separate FastAPI service and a real CatVTON adapter. The existing
React/Three.js studio, Cloudflare storage and saved outfits are preserved.
The React photo-try-on screen is **Phase 2**, so the existing page looks the same.

**Implemented scope:** one person photo plus one shirt/T-shirt product image;
EXIF correction; aspect-preserving preparation; garment transparency or plain
background removal; SCHP human parsing; DensePose body-part estimation;
automatic clothing masking; protected face/hair regions; CatVTON inference;
compositing into the original-resolution photo; diagnostic files and API downloads.

**Not enabled yet:** bottoms, dresses, jackets, multi-piece outfits, sketch
generation, a history browser, or production authentication. The category schema
reserves those categories, but requests for them return an explicit error.
This phase generates a still image in the original pose; it is not a 3D avatar,
body-measurement estimator or fit guarantee.

## Verification status

The CPU tests use synthetic model output only inside the tests. They verify
image validation, geometry-preserving transforms, exact preservation of pixels
outside the edit mask, protected pixels, API behavior, serialized GPU access,
failure handling and saved artifacts. They do **not** measure model quality.
There is no mock/fake generation mode in the application.

Run the real smoke test on the RTX 4060 before claiming inference works on that
machine. Inspect the result and masks before claiming identity or garment fidelity.

## 1. Start an isolated Windows environment

Open a new PowerShell terminal. Keep the frontend's Vite terminal running.
From the cloned repository:

```powershell
cd "C:\Users\Praveen Raj\Virtual-Try-on"
git pull origin main

conda create -n vton python=3.10 -y
conda activate vton
python --version
python -m pip install -r backend/requirements.txt

nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
```

If you already created `vton`, activate it instead of recreating it. Keep your
existing `sde` environment for its current projects. No activation-policy changes
or system-wide package installation are required.

Install the matched CUDA wheels and the model dependencies:

```powershell
python -m pip install torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cu121
python -m pip install -r backend/requirements-model.txt
python -m pip check
python -m backend.scripts.diagnose
```

These are compatibility pins for the selected CatVTON revision, not a request to
upgrade another project's PyTorch. The CUDA runtime in the wheel and the CUDA
version displayed by `nvidia-smi` need not be identical. The NVIDIA driver must
support the wheel. Do not install a standalone CUDA toolkit just to resolve an
unrelated Python import error.

At this point `cuda_available` should be `true`. Missing source and weights are
expected until the next step. If CUDA is false or PyTorch cannot import, stop
there and send the full diagnostic output. GPU capacity and installation have
not been inferred from the model name alone.

### Windows `fbgemm.dll` / WinError 126 during `import torch`

PyTorch 2.4.0 has a documented Windows binary dependency regression, fixed in
[2.4.1](https://github.com/pytorch/pytorch/issues/131662#issuecomment-2329870544).
If you installed the earlier project pins, close running Python/backend processes
and update the matched pair in the existing environment:

```powershell
conda activate vton
python -m pip install --upgrade torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cu121
python -m pip check
python -c "import torch; print('Torch:', torch.__version__); print('CUDA:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'unavailable')"
python -m backend.scripts.diagnose --check-imports
```

An import failure does not establish whether CUDA or your GPU works. Diagnostics
now report `torch_imported: false` and `cuda_available: null` when import fails;
`false` is reserved for a completed CUDA availability check. Missing weights are
expected until step 3. Do not download weights until imports and CUDA pass.
The regression matches this error, but the error alone does not identify which
DLL dependency is missing. If it persists with 2.4.1, share the new traceback;
the next check is the official Microsoft x64 Visual C++ runtime installation.
Do not copy DLLs from third-party download sites into Windows system folders.
Windows inference still requires the real smoke test below.

## 2. Install pinned CatVTON source and check imports

```powershell
python -m backend.scripts.setup_model
python -m backend.scripts.diagnose --check-imports
```

The helper checks out revision
`7818397f25613beedb3d861a34769f607cfcf3b1` under
`backend/external/CatVTON`. It does not silently overwrite an existing different
checkout. We use its localized SCHP/DensePose implementation and PyTorch's
attention implementation; installing xformers is not required for this path.

`model_imports` should say `passed`. This imports the real pipeline and masker
without loading weights. The diagnostic can still return exit code 1 because
weights have not been downloaded yet. Import success alone is not inference.

Native Windows is the first path to try with this isolated environment. If a
dependency fails, share its actual traceback. WSL2 is an alternative for Linux
compatibility, not a required unexplained operating-system migration. Do not mix
Windows Python packages with a WSL Python environment.

## 3. Download weights

Only after CUDA and model imports work:

```powershell
python -m backend.scripts.setup_model --download-weights
python -m backend.scripts.diagnose --check-imports
```

This downloads several GB from Hugging Face. It downloads model files only; your
photographs are never uploaded to Hugging Face. It records the resolved snapshot
revisions and local paths in ignored `backend/data/model-install.json`.
Subsequent setup runs reuse those snapshots. The inference adapter loads the base
model, VAE and attention weights from those local paths.

The Stable Diffusion inpainting repository used here is the maintained mirror
`stable-diffusion-v1-5/stable-diffusion-inpainting`, rather than the deprecated
Runway identifier in the upstream example. No API inference subscription is used.
If Hugging Face returns an access or rate-limit error, report that exact error;
do not put a token in source files or paste one into the chat.

## 4. Run the first actual try-on

Use a clear photograph of one person, facing forward with their face visible and
arms slightly apart. Use a shirt photographed alone on a contrasting plain
background, or a transparent garment PNG. A full-body photo is accepted, but
close enough framing improves the number of model pixels available for the shirt.
Do not use a costume sketch for this baseline.

Place your private inputs in `backend/data/input/` (ignored by Git):

```powershell
New-Item -ItemType Directory -Force backend/data/input
```

Copy the person and garment photos there as `person.jpg` and `shirt.png`, then:

```powershell
python -m backend.scripts.smoke_test --person "backend/data/input/person.jpg" --garment "backend/data/input/shirt.png"
```

Defaults: upper-body garment, 576 x 768 model canvas, 30 steps, seed 42,
batch size one, BF16 when supported and FP16 otherwise. Masking models are
released before the diffusion model is loaded. VAE slicing and tiling are enabled.
Peak allocated/reserved GPU memory and timings are recorded. Models are released
after the request; this trades repeated loading time for bounded idle memory.

For an already clean opaque product image that should not be background-removed:

```powershell
python -m backend.scripts.smoke_test --person "backend/data/input/person.jpg" --garment "backend/data/input/shirt.png" --garment-background keep
```

`keep` keeps the product image background; it does not create a better garment
mask. Plain-background removal uses edge-connected colour segmentation, not a
learned garment segmentation model. Low-contrast white-on-white clothes and busy
backgrounds can fail; use a better product input in this first phase.

Once preview inference fits in memory, evaluate the larger model canvas:

```powershell
python -m backend.scripts.smoke_test --person "backend/data/input/person.jpg" --garment "backend/data/input/shirt.png" --quality detail --steps 40
```

There is no silent resolution downgrade or CPU-generated substitute when CUDA
fails. Fewer denoising steps reduce runtime but do not substantially reduce the
memory needed for one denoising step. Use preview resolution and close other GPU
applications if you encounter `gpu_out_of_memory`.

Outputs go to `backend/data/runs/<run-id>/`:

| File | Inspect for |
| --- | --- |
| `person.png` | EXIF-corrected original photo |
| `garment.png`, `garment-mask.png` | Retained garment details and removed background |
| `person-canvas.png`, `garment-canvas.png` | Aspect-preserving padded model inputs |
| `segmentation.png`, `densepose.png` | Body parsing and DensePose labels; not anatomical measurements |
| `edit-mask.png` | White means the clothing region can change |
| `protected-mask.png` | Face, hair, hat and glasses protection on the model canvas |
| `generated.png` | Raw model result before original pixels are restored |
| `result.png` | Composite at the oriented original photo dimensions |
| `alpha.png` | Original-resolution blending mask; black pixels stay exactly original |
| `comparison.png` | Original/result comparison |
| `report.json` | Options, seed, revisions, timings, memory and completion/error status |

Face protection depends on correct segmentation. Pixel preservation is exact
where the final mask is black, but that is not proof the model identified every
face/hair pixel correctly. Necklines, hair occlusion, sleeves, logos and fabric
patterns still need visual evaluation. The output is appearance estimation, not
a measurement-based fit prediction.

## 5. Start and test FastAPI

The API can start with just `requirements.txt`; model requests correctly report
missing dependencies/CUDA/weights until the model installation is complete.
Run from the repository root:

```powershell
conda activate vton
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Do not use `--reload` or multiple workers for GPU testing. One API instance handles
one generation at a time; a second concurrent request returns `409 gpu_busy`.
Do not run the CLI generation and an API generation simultaneously either.

Open <http://127.0.0.1:8000/docs>. Use `GET /health`, then `GET /diagnostics`.
Expand `POST /v1/try-on`, select **Try it out**, choose the two files, leave
`category=upper`, and execute. The response supplies result and comparison URLs.
This request waits for generation; asynchronous progress and queue recovery are
part of Phase 2.

PowerShell health check and an actual multipart request:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
curl.exe --max-time 900 -X POST http://127.0.0.1:8000/v1/try-on -F "person=@backend/data/input/person.jpg" -F "garment=@backend/data/input/shirt.png" -F "category=upper" -F "quality=preview"
```

The `http://127.0.0.1:5173` React studio still runs separately. Nothing is being
sent to your hosted site. This is a local single-user API, not a production
multi-user authentication system. Keep it bound to loopback; do not expose it
through a public tunnel. New AI results are filesystem run folders, not rows in
the existing Cloudflare saved-look database. A SQLite history index and UI come
in Phase 2. Deleting a run folder removes that local run and its images.

## Tests and errors

```powershell
python -m pip install -r backend/requirements-dev.txt
python -m pytest backend/tests -q
```

| Error | Next check |
| --- | --- |
| `torch_missing` / DLL import error | Correct conda environment, CUDA wheel and the exact traceback |
| `cuda_unavailable` | `nvidia-smi` and `python -m backend.scripts.diagnose` |
| `model_source_missing` | Run `setup_model`; inspect the pinned checkout |
| `model_dependencies` | Run `diagnose --check-imports`; report the named missing/incompatible package |
| `weights_missing` | Complete `setup_model --download-weights` |
| `person_not_detected` / `person_mask` | One clearly visible person, better framing, face visible |
| `garment_background` / `garment_mask` | Plain contrasting background or transparent PNG |
| `gpu_out_of_memory` | Preview quality and available VRAM; share the diagnostics |
| `inference_failed` | Share the backend terminal traceback; no substitute output is returned |

## Files and next phases

- `backend/app/main.py`: local FastAPI endpoints.
- `backend/app/service.py`: orchestration, single-job lock and run artifacts.
- `backend/app/images.py`: validation, garment background processing, letterboxing and compositing.
- `backend/app/models/catvton.py`: actual upstream model integration.
- `backend/app/diagnostics.py`: environment and CUDA checks.
- `backend/scripts/`: setup, diagnosis and real-image smoke test commands.
- `backend/tests/test_baseline.py`: CPU-verifiable tests.

Next: React person/photo workflow plus asynchronous jobs and history. Then test
lower-body and dress handling before enabling it, then ordered outfit passes.
Designer mode later converts a sketch into a reviewable garment reference before
try-on. LoRA training is deferred until comparisons show a concrete need.

## Upstream references and license

- [Pinned CatVTON source and license](https://github.com/Zheng-Chong/CatVTON/tree/7818397f25613beedb3d861a34769f607cfcf3b1): CC BY-NC-SA 4.0; research/non-commercial use.
- [CatVTON weights](https://huggingface.co/zhengchong/CatVTON).
- [Inpainting model mirror](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting).
- [VAE model](https://huggingface.co/stabilityai/sd-vae-ft-mse).
- [Official PyTorch previous-version installation commands](https://pytorch.org/get-started/previous-versions/).

Upstream source and checkpoints are downloaded separately, not redistributed in
this repository. Their licenses continue to apply; this is not a cleared
commercial inference stack.

## Collar mask correction

The upper-body mask now reopens LIP-labelled upper clothing in a bounded band
below the detected LIP face, including when ATR face/neck protection or mask
expansion previously excluded it. LIP face and ATR hair/accessory labels remain
protected. This is a segmentation-based heuristic, not proof of an anatomical
boundary; inspect neckline and skin preservation on each test image.
`segmentation-atr.png` is now saved alongside the LIP segmentation for diagnosis.
Three CPU regression tests cover collar conflicts, protected face/hair/neck,
and missing face labels. GPU/visual improvement must be verified by rerunning:

```powershell
python -m unittest discover -s backend/tests -p test_masking.py -v
python -m backend.scripts.smoke_test --person "backend/data/input/person.jpg" --garment "backend/data/input/shirt.jpg" --seed 42
```

Compare the new run with the previous run's result and masks. No weights need
redownloading, and previous run folders are retained.
