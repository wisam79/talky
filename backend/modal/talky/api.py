"""
مسارات FastAPI لتطبيق Talky مع معالجة CORS والاستجابات الموحدة
"""

import os
import time
import tempfile
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .schemas import (
    GenerateRequest,
    GenerateSuccess,
    GenerateFailure,
    AudioResult,
    MetaResult,
    Timings,
    ApiErrorSchema,
)
from .errors import TalkyError, TextEmptyError, TextTooLongError
from .limits import MAX_TEXT_LENGTH
from .audio import encode_audio_file


def create_app(engine_instance=None):
    app = FastAPI(title="Talky Arabic Neural Studio API", version="1.0.0")

    # تفعيل CORS بالكامل لصفحات GitHub Pages والمتصفحات
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # معالجة أخطاء TalkyError المخصصة
    @app.exception_handler(TalkyError)
    async def talky_error_handler(request: Request, exc: TalkyError):
        failure = GenerateFailure(
            requestId=getattr(request.state, "request_id", "unknown"),
            error=ApiErrorSchema(
                code=exc.code,
                message=exc.message,
                messageAr=exc.message_ar,
                retryable=exc.retryable,
                details=exc.details,
            ),
        )
        return JSONResponse(status_code=exc.status_code, content=failure.model_dump())

    # معالجة الأخطاء العامة غير المتوقعة
    @app.exception_handler(Exception)
    async def generic_error_handler(request: Request, exc: Exception):
        failure = GenerateFailure(
            requestId=getattr(request.state, "request_id", "unknown"),
            error=ApiErrorSchema(
                code="SERVICE_UNAVAILABLE",
                message=str(exc),
                messageAr="حدث خطأ أثناء معالجة الصوت",
                retryable=True,
            ),
        )
        return JSONResponse(status_code=500, content=failure.model_dump())

    @app.get("/v1/health")
    @app.get("/api/health")
    @app.get("/health")
    @app.get("/")
    async def health():
        return {
            "ok": True,
            "model": "neural-azure-ar",
            "engine": getattr(engine_instance, "engine_type", "neural_azure") if engine_instance else "neural_azure",
            "version": "2.0.0",
            "warm": engine_instance is not None and getattr(engine_instance, "initialized", False),
        }

    @app.post("/v1/generate")
    @app.post("/api/generate")
    async def generate(req: GenerateRequest, request: Request):
        request.state.request_id = req.requestId
        total_start = time.perf_counter()

        # التحقق من النص
        clean_text = req.text.strip()
        if not clean_text:
            raise TextEmptyError()
        if len(clean_text) > MAX_TEXT_LENGTH:
            raise TextTooLongError(len(clean_text), MAX_TEXT_LENGTH)

        # تحديد نبرة الصوت والشخصية
        voice_id = "builtin:faseeh"
        if req.voice:
            if req.voice.voiceId:
                voice_id = req.voice.voiceId
            elif getattr(req.voice, "type", "") == "preset":
                voice_id = getattr(req.voice, "voiceId", "builtin:faseeh") or "builtin:faseeh"

        speed = req.options.speed if req.options else 1.0
        pitch = getattr(req.options, "pitch", 0) or 0
        target_fmt = req.options.format if req.options else "wav"

        # استخدام المحرك المتاح
        engine = engine_instance
        if engine is None:
            from .engine import NeuralToneEngine
            engine = NeuralToneEngine()

        with tempfile.TemporaryDirectory() as work_dir:
            output_wav_path = os.path.join(work_dir, "output.wav")

            # استدعاء محرك النبرات الصوتية العصبية
            infer_start = time.perf_counter()
            if hasattr(engine, "infer_async"):
                infer_ms, sr = await engine.infer_async(
                    text=clean_text,
                    voice_id=voice_id,
                    output_file=output_wav_path,
                    speed=speed,
                    pitch=pitch,
                )
            else:
                infer_ms, sr = engine.infer(
                    text=clean_text,
                    voice_id=voice_id,
                    output_file=output_wav_path,
                    speed=speed,
                    pitch=pitch,
                )

            # ترميز الملف وحساب المدة بدقة
            encode_start = time.perf_counter()
            b64_audio, duration_ms = encode_audio_file(output_wav_path, target_format=target_fmt)
            encode_ms = int((time.perf_counter() - encode_start) * 1000)

            total_ms = int((time.perf_counter() - total_start) * 1000)

            response = GenerateSuccess(
                requestId=req.requestId,
                audio=AudioResult(
                    base64=b64_audio,
                    format=target_fmt,
                    mimeType="audio/wav" if target_fmt == "wav" else "audio/mpeg",
                    sampleRate=sr,
                    durationMs=duration_ms,
                ),
                meta=MetaResult(
                    model="neural-azure-ar",
                    coldStart=getattr(engine, "is_cold_start", False),
                    seed=req.options.seed if req.options else None,
                    timings=Timings(
                        inferMs=infer_ms,
                        encodeMs=encode_ms,
                        totalMs=total_ms,
                    ),
                ),
            )
            return JSONResponse(status_code=200, content=response.model_dump())

    return app
