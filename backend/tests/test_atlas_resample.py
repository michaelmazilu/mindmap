"""Atlas helpers (no nilearn download required)."""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from atlas import _resample_to_length  # noqa: E402


def test_resample_passthrough():
    a = np.arange(10, dtype=np.float64)
    out = _resample_to_length(a, 10)
    assert out.shape == (10,)
    np.testing.assert_allclose(out, a)


def test_resample_interpolate():
    a = np.array([0.0, 1.0], dtype=np.float64)
    out = _resample_to_length(a, 5)
    assert out.shape == (5,)
    assert out[0] == pytest.approx(0.0)
    assert out[-1] == pytest.approx(1.0)
