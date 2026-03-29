"""
Text-to-Speech conversion for the TRIBE v2 pipeline.

Uses Edge TTS (free, no API key) to convert tweet text to audio bytes.
The audio is fed into TRIBE v2's audio-to-brain prediction model.
"""

import asyncio
import io
import tempfile

import numpy as np


async def text_to_speech(text: str) -> np.ndarray:
    """
    Convert text to speech audio using Edge TTS.

    Returns numpy array of audio samples (16kHz, mono, float32).
    """
    try:
        import edge_tts

        communicate = edge_tts.Communicate(text, "en-US-AriaNeural")

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=True) as tmp:
            await communicate.save(tmp.name)
            tmp.seek(0)
            audio_bytes = tmp.read()

        import soundfile as sf
        audio_data, sample_rate = sf.read(io.BytesIO(audio_bytes))

        if len(audio_data.shape) > 1:
            audio_data = audio_data.mean(axis=1)

        if sample_rate != 16000:
            ratio = 16000 / sample_rate
            new_length = int(len(audio_data) * ratio)
            indices = np.linspace(0, len(audio_data) - 1, new_length)
            audio_data = np.interp(indices, np.arange(len(audio_data)), audio_data)

        return audio_data.astype(np.float32)

    except ImportError as e:
        raise RuntimeError(
            f"TTS dependencies not installed: {e}. "
            "Install with: pip install edge-tts soundfile"
        )


def text_to_speech_sync(text: str) -> np.ndarray:
    """Synchronous wrapper for text_to_speech."""
    return asyncio.run(text_to_speech(text))
