"""Diagnostic states tested without loading a GPU or downloading weights."""
import builtins
import sys
from types import SimpleNamespace

import unittest
from unittest.mock import patch
from tempfile import TemporaryDirectory
from pathlib import Path

from backend.app.config import Settings
from backend.app.diagnostics import diagnose


def check_failed_import(tmp_path):
    original_import = builtins.__import__

    def failing_import(name, *args, **kwargs):
        if name == "torch":
            raise OSError("[WinError 126] Error loading fbgemm.dll or one of its dependencies")
        return original_import(name, *args, **kwargs)

    with patch("builtins.__import__", failing_import):
        report = diagnose(Settings(data_dir=tmp_path, source_dir=tmp_path / "missing"))
    assert report["torch_imported"] is False
    assert report["cuda_available"] is None
    assert report["torch_cuda_runtime"] is None
    assert any("fbgemm.dll" in problem for problem in report["problems"])
    assert not any("CUDA is unavailable" in problem for problem in report["problems"])


def check_completed_cuda(tmp_path, available):
    fake_torch = SimpleNamespace(
        version=SimpleNamespace(cuda="12.1"),
        cuda=SimpleNamespace(
            is_available=lambda: available,
            device_count=lambda: 1,
            get_device_properties=lambda index: SimpleNamespace(name="Test GPU", total_memory=8 * 2**30),
            is_bf16_supported=lambda: True,
        ),
    )
    with patch.dict(sys.modules, {"torch": fake_torch}):
        report = diagnose(Settings(data_dir=tmp_path, source_dir=tmp_path / "missing"))
    assert report["torch_imported"] is True
    assert report["cuda_available"] is available
    assert report["torch_cuda_runtime"] == "12.1"
    assert bool(report["gpus"]) is available
    assert report["inference_verified"] is False


class DiagnosticTests(unittest.TestCase):
    def test_import_failure(self):
        with TemporaryDirectory() as directory:
            check_failed_import(Path(directory))

    def test_cuda_available(self):
        with TemporaryDirectory() as directory:
            check_completed_cuda(Path(directory), True)

    def test_cuda_unavailable(self):
        with TemporaryDirectory() as directory:
            check_completed_cuda(Path(directory), False)
