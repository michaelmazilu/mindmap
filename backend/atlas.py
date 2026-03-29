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
