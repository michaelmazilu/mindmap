"""
Brain atlas — maps voxel/vertex activations to named anatomical regions.

Uses the Destrieux atlas (aparc.a2009s) parcellation on fsaverage surface.
For MVP, provides a lookup table mapping vertex ranges to region names.
For production, load the actual .annot file from FreeSurfer.
"""

from dataclasses import dataclass

import numpy as np


@dataclass
class RegionActivation:
    name: str
    activation: float
    function: str
    vertex_indices: list[int] = None


DESTRIEUX_REGIONS = {
    "Visual Cortex (V1)": {
        "function": "visual processing",
        "lobe": "occipital",
    },
    "Fusiform Gyrus": {
        "function": "face/word recognition",
        "lobe": "temporal",
    },
    "Amygdala": {
        "function": "threat detection",
        "lobe": "temporal",
    },
    "Broca's Area": {
        "function": "speech production",
        "lobe": "frontal",
    },
    "Wernicke's Area": {
        "function": "language comprehension",
        "lobe": "temporal",
    },
    "Anterior Cingulate Cortex": {
        "function": "conflict monitoring",
        "lobe": "frontal",
    },
    "Insula": {
        "function": "emotional awareness",
        "lobe": "insular",
    },
    "Prefrontal Cortex": {
        "function": "executive control",
        "lobe": "frontal",
    },
    "Dorsolateral PFC": {
        "function": "working memory",
        "lobe": "frontal",
    },
    "Ventromedial PFC": {
        "function": "value judgment",
        "lobe": "frontal",
    },
    "Orbitofrontal Cortex": {
        "function": "reward processing",
        "lobe": "frontal",
    },
    "Temporal Pole": {
        "function": "social cognition",
        "lobe": "temporal",
    },
    "Superior Temporal Sulcus": {
        "function": "social perception",
        "lobe": "temporal",
    },
    "Precuneus": {
        "function": "self-referential thought",
        "lobe": "parietal",
    },
    "Motor Cortex": {
        "function": "movement planning",
        "lobe": "frontal",
    },
    "Hippocampus": {
        "function": "memory formation",
        "lobe": "temporal",
    },
    "Angular Gyrus": {
        "function": "semantic integration",
        "lobe": "parietal",
    },
}


class BrainAtlas:
    """
    Maps vertex-level activations to named brain regions.

    Production: Load a FreeSurfer .annot file for precise vertex → region mapping.
    MVP: Divide vertex space into rough parcels by index range.
    """

    def __init__(self, annot_path: str = None):
        self.regions = DESTRIEUX_REGIONS
        self.parcellation = None

        if annot_path:
            self._load_annot(annot_path)
        else:
            self._create_mock_parcellation()

    def _load_annot(self, path: str):
        """Load FreeSurfer annotation file for precise mapping."""
        try:
            import nibabel as nib
            labels, ctab, names = nib.freesurfer.read_annot(path)
            self.parcellation = labels
        except ImportError:
            self._create_mock_parcellation()

    def _create_mock_parcellation(self, n_vertices: int = 163842):
        """Create approximate vertex-to-region mapping."""
        region_names = list(self.regions.keys())
        n_regions = len(region_names)
        self.parcellation = np.array(
            [i % n_regions for i in range(n_vertices)],
            dtype=np.int32,
        )
        self._region_index = {name: i for i, name in enumerate(region_names)}

    def lookup_top_regions(
        self,
        activations: np.ndarray,
        n: int = 5,
    ) -> list[dict]:
        """
        Given per-vertex activations, return the top N activated regions.
        """
        region_names = list(self.regions.keys())
        region_activations = {}

        for i, name in enumerate(region_names):
            mask = self.parcellation == i
            if mask.any():
                region_act = float(np.mean(activations[mask]))
                region_activations[name] = region_act

        sorted_regions = sorted(
            region_activations.items(),
            key=lambda x: x[1],
            reverse=True,
        )

        results = []
        for name, activation in sorted_regions[:n]:
            info = self.regions.get(name, {})
            results.append({
                "name": name,
                "activation": round(activation, 3),
                "function": info.get("function", "unknown"),
            })

        return results

def _resample_to_length(activations: np.ndarray, target: int) -> np.ndarray:
    """Linearly resample 1D activations to *target* vertices (fsaverage5 cortical)."""
    arr = np.asarray(activations, dtype=np.float64).ravel()
    if arr.size == target:
        return arr
    if arr.size < 2:
        return np.full(target, float(arr[0]) if arr.size else 0.0)
    x_old = np.linspace(0.0, 1.0, arr.size)
    x_new = np.linspace(0.0, 1.0, target)
    return np.interp(x_new, x_old, arr)


def _function_for_destrieux(name: str) -> str:
    """Map Destrieux-style label to a short functional gloss."""
    u = name.upper()
    if "VISUAL" in u or "OCCIP" in u or "CALCAR" in u:
        return "visual processing"
    if "TEMPORAL" in u and ("POLE" in u or "ENTO" in u):
        return "social cognition"
    if "STS" in u or "SUPERIOR TEMPORAL" in u:
        return "language / social perception"
    if "INSULA" in u:
        return "emotional awareness"
    if "CING" in u:
        return "conflict monitoring"
    if "PRECUNE" in u:
        return "self-referential thought"
    if "FRONTAL" in u or "PARS" in u or "OPERC" in u:
        return "executive / language-related cortex"
    if "PARIET" in u or "ANGULAR" in u:
        return "semantic integration"
    if "MOTOR" in u or "PRE-CENT" in u or "PRECENT" in u:
        return "movement planning"
    if "HIPPO" in u or "PARAHIPPO" in u:
        return "memory-related cortex"
    return "cortical information processing"


def surf_destrieux_top_regions(activations: np.ndarray, n: int = 3) -> list[dict]:
    """
    Map TRIBE v2 vertex activations to top Destrieux parcels on fsaverage5.

    TRIBE outputs are cortical vertices; we align to nilearn's surface Destrieux
    atlas (10242 vertices per hemisphere).
    """
    try:
        from nilearn.datasets import fetch_atlas_surf_destrieux
    except ImportError as e:
        raise RuntimeError("nilearn required for surface atlas: pip install nilearn") from e

    atlas = fetch_atlas_surf_destrieux()
    n_l = int(atlas["map_left"].shape[0])
    n_r = int(atlas["map_right"].shape[0])
    target = n_l + n_r

    arr = _resample_to_length(activations, target)
    left = arr[:n_l]
    right = arr[n_l : n_l + n_r]

    labels = atlas["labels"]
    sum_by: dict[int, float] = {}
    cnt_by: dict[int, int] = {}

    def accumulate(side_map, side_act):
        for vi in range(side_map.shape[0]):
            li = int(side_map[vi])
            if li < 0:
                continue
            name = str(labels[li]) if li < len(labels) else f"label_{li}"
            if not name or name.lower() in ("medial_wall", "unknown", "background"):
                continue
            sum_by[li] = sum_by.get(li, 0.0) + float(side_act[vi])
            cnt_by[li] = cnt_by.get(li, 0) + 1

    accumulate(atlas["map_left"], left)
    accumulate(atlas["map_right"], right)

    means: list[tuple[int, float, str]] = []
    for li, s in sum_by.items():
        c = cnt_by.get(li, 1)
        m = s / max(c, 1)
        nm = str(labels[li]) if li < len(labels) else f"region_{li}"
        means.append((li, m, nm))

    means.sort(key=lambda t: t[1], reverse=True)

    # Scale raw means to widget-friendly 0.2–0.95
    top = means[: max(n, 3)]
    if not top:
        return [
            {"name": "Cortex (unspecified)", "activation": 0.5, "function": "cortical processing"},
        ]
    vals = np.array([t[1] for t in top[:n]], dtype=np.float64)
    lo, hi = float(vals.min()), float(vals.max())
    if hi - lo < 1e-9:
        scaled = np.full(len(vals), 0.55)
    else:
        scaled = 0.2 + (vals - lo) / (hi - lo) * 0.75

    out: list[dict] = []
    for i, (_, _raw, nm) in enumerate(top[:n]):
        out.append({
            "name": nm.replace("_", " ")[:160],
            "activation": round(float(scaled[i]), 3),
            "function": _function_for_destrieux(nm),
        })
    return out

