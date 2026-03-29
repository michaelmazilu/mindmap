"""
TRIBE v2 inference wrapper — placeholder for production pipeline.

When ready to swap in the real model:
1. Clone Meta's TRIBE v2 repo
2. Download model weights
3. Replace the mock predict() below with the real BrainModel forward pass

The real pipeline:
  text → TTS audio (Edge TTS) → TRIBE v2 forward pass → (n_vertices,) activation array
"""

import numpy as np


class TRIBERunner:
    """
    Wraps TRIBE v2 model inference. Currently a stub — returns
    random activations shaped to plausible fsaverage vertex counts.
    """

    def __init__(self, model_path: str = None):
        self.model_path = model_path
        self.loaded = False
        # Real implementation would load the TRIBE v2 model here:
        # from tribe_v2.model import BrainModel
        # self.model = BrainModel.from_pretrained(model_path)

    def predict(self, audio_array: np.ndarray) -> np.ndarray:
        """
        Run TRIBE v2 inference on audio input.

        Args:
            audio_array: Audio waveform as numpy array (from TTS)

        Returns:
            Activation values per vertex, shape (163842,) for fsaverage
        """
        # Stub: return shaped noise. Replace with real model call:
        # return self.model.predict(audio_array)
        n_vertices = 163842  # fsaverage vertex count
        rng = np.random.default_rng(hash(audio_array.tobytes()) % 2**32)
        activations = rng.exponential(0.1, size=n_vertices)
        activations = np.clip(activations, 0, 1)
        return activations.astype(np.float32)
