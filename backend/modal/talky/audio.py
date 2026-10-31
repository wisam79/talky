"""
معالجة وفحص وتطبيع الملفات الصوتية عبر soundfile أو wave المدمجة و ffmpeg
"""

import os
import base64
import subprocess
import tempfile
import wave
from typing import Tuple

try:
    import soundfile as sf
except ImportError:
    sf = None

from .limits import (
    MIN_REF_AUDIO_DURATION_SEC,
    MAX_REF_AUDIO_DURATION_SEC,
    TARGET_SAMPLE_RATE,
    TARGET_CHANNELS,
)
from .errors import (
    RefAudioInvalidError,
    RefAudioTooShortError,
    RefAudioTooLongError,
)


def decode_base64_audio(b64_string: str) -> bytes:
    """فك تشفير الـ Base64 مع معالجة البادئات data:audio/... المحتملة"""
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    
    b64_string = b64_string.strip()
    try:
        return base64.b64decode(b64_string)
    except Exception as e:
        raise RefAudioInvalidError(f"فشل فك تشفير Base64: {str(e)}")


def normalize_reference_audio(raw_audio_bytes: bytes, work_dir: str) -> Tuple[str, float]:
    """
    تطبيع العينة الصوتية المرجعية عبر ffmpeg لتصبح:
    - 24000 Hz
    - 1 Channel (Mono)
    - 16-bit PCM WAV
    وفحص مدة العينة ومطابقتها للشروط.
    """
    input_path = os.path.join(work_dir, "raw_reference_input")
    output_path = os.path.join(work_dir, "normalized_ref_24k.wav")

    with open(input_path, "wb") as f:
        f.write(raw_audio_bytes)

    cmd = [
        "ffmpeg",
        "-y",
        "-i", input_path,
        "-vn",
        "-ar", str(TARGET_SAMPLE_RATE),
        "-ac", str(TARGET_CHANNELS),
        "-c:a", "pcm_s16le",
        output_path,
    ]

    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    except Exception as e:
        raise RefAudioInvalidError(f"فشل معالجة الصوت بـ ffmpeg: {str(e)}")

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise RefAudioInvalidError("الملف الصوتي الناتج فارغ أو تالف")

    duration_sec = 0.0
    if sf is not None:
        try:
            info = sf.info(output_path)
            duration_sec = info.duration
        except Exception:
            pass

    if duration_sec == 0.0:
        try:
            with wave.open(output_path, "rb") as w:
                frames = w.getnframes()
                rate = w.getframerate()
                if rate > 0:
                    duration_sec = frames / rate
        except Exception as e:
            raise RefAudioInvalidError(f"تعذر قراءة خصائص الصوت: {str(e)}")

    if duration_sec < MIN_REF_AUDIO_DURATION_SEC:
        raise RefAudioTooShortError(duration_sec, MIN_REF_AUDIO_DURATION_SEC)
    
    if duration_sec > MAX_REF_AUDIO_DURATION_SEC:
        raise RefAudioTooLongError(duration_sec, MAX_REF_AUDIO_DURATION_SEC)

    return output_path, duration_sec


def encode_audio_file(file_path: str, target_format: str = "wav") -> Tuple[str, int]:
    """
    قراءة الملف الصوتي الناتج وحساب مدته بالمللي ثانية وترميزه إلى Base64
    """
    duration_ms = 0
    if sf is not None:
        try:
            info = sf.info(file_path)
            duration_ms = int(info.duration * 1000)
        except Exception:
            pass

    if duration_ms == 0:
        try:
            with wave.open(file_path, "rb") as w:
                frames = w.getnframes()
                rate = w.getframerate()
                if rate > 0:
                    duration_ms = int((frames / rate) * 1000)
        except Exception:
            pass

    if duration_ms == 0:
        size_bytes = os.path.getsize(file_path)
        duration_ms = int((size_bytes / 48000) * 1000)

    with open(file_path, "rb") as f:
        audio_bytes = f.read()

    b64_data = base64.b64encode(audio_bytes).decode("utf-8")
    return b64_data, duration_ms
