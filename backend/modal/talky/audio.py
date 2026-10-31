"""
معالجة وفحص وتطبيع الملفات الصوتية عبر soundfile و ffmpeg
"""

import os
import base64
import subprocess
import tempfile
import soundfile as sf
from typing import Tuple

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
    
    # تنظيف المسافات البيضاء والأسطر
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

    # حفظ الملف الأصلي
    with open(input_path, "wb") as f:
        f.write(raw_audio_bytes)

    # تشغيل أمر ffmpeg للتطبيع السريع
    cmd = [
        "ffmpeg",
        "-y",
        "-i", input_path,
        "-vn",                   # تجاهل الفيديو إن وجد
        "-ar", str(TARGET_SAMPLE_RATE),
        "-ac", str(TARGET_CHANNELS),
        "-c:a", "pcm_s16le",
        output_path,
    ]

    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    except Exception as e:
        raise RefAudioInvalidError(f"فشل معالجة الصوت بـ ffmpeg: {str(e)}")

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise RefAudioInvalidError("الملف الصوتي الناتج فارغ أو تالف")

    # فحص مدة الصوت وخصائصه عبر soundfile
    try:
        info = sf.info(output_path)
        duration_sec = info.duration
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
    info = sf.info(file_path)
    duration_ms = int(info.duration * 1000)

    with open(file_path, "rb") as f:
        audio_bytes = f.read()

    b64_data = base64.b64encode(audio_bytes).decode("utf-8")
    return b64_data, duration_ms
