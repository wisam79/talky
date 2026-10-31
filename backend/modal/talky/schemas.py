"""
عقود البيانات ونماذج Pydantic المطابقة لمواصفة Talky TypeScript
"""

from typing import Optional, Literal, Dict, Any
from pydantic import BaseModel, Field


class ReferencePayload(BaseModel):
    audioBase64: str = Field(..., description="WAV/Audio base64 بدون بادئة data:")
    mimeType: Literal["audio/wav", "audio/mpeg", "audio/ogg"] = "audio/wav"
    refText: str = Field(..., description="النص المطابق حرفياً لما يُقال في العينة المرجعية")


class VoicePayload(BaseModel):
    type: Literal["inline"] = "inline"
    reference: ReferencePayload


class GenerateOptions(BaseModel):
    speed: float = Field(1.0, ge=0.5, le=2.0, description="سرعة الإلقاء")
    seed: Optional[int] = Field(None, description="بذرة التوليد العشوائي لتكرار النتيجة")
    format: Literal["wav", "mp3"] = "wav"


class GenerateRequest(BaseModel):
    apiVersion: int = Field(1, description="إصدار العقد البرمجي")
    requestId: str = Field(..., description="معرف فريد للطلب UUID v4")
    text: str = Field(..., min_length=1, max_length=600, description="النص العربي المراد نطقه")
    voice: VoicePayload
    options: GenerateOptions = Field(default_factory=GenerateOptions)
    client: Optional[Dict[str, Any]] = None


class AudioResult(BaseModel):
    base64: str
    format: Literal["wav", "mp3"]
    mimeType: Literal["audio/wav", "audio/mpeg"]
    sampleRate: int = 24000
    durationMs: int


class Timings(BaseModel):
    inferMs: int
    encodeMs: int
    totalMs: int


class MetaResult(BaseModel):
    model: str = "silma-tts-v1"
    coldStart: bool = False
    seed: Optional[int] = None
    timings: Timings


class ApiErrorSchema(BaseModel):
    code: str
    message: str
    messageAr: str
    retryable: bool = False
    details: Optional[Dict[str, Any]] = None


class GenerateSuccess(BaseModel):
    ok: Literal[True] = True
    apiVersion: int = 1
    requestId: str
    audio: AudioResult
    meta: MetaResult


class GenerateFailure(BaseModel):
    ok: Literal[False] = False
    apiVersion: int = 1
    requestId: str
    error: ApiErrorSchema
