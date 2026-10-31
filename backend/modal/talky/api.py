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
from .audio import decode_base64_audio, normalize_reference_audio, encode_audio_file


def create_app(engine_instance=None):
    app = FastAPI(title="Talky Arabic TTS API", version="1.0.0")

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
                messageAr="حدث خطأ غير متوقع في السيرفر السحابي",
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
            "model": "silma-tts-v1",
            "engine": getattr(engine_instance, "engine_type", "unknown") if engine_instance else "unknown",
            "version": "1.0.0",
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

        # تجهيز المجلد المؤقت للطلب
        with tempfile.TemporaryDirectory() as work_dir:
            # 1. فك وتطبيع العينة الصوتية المرجعية
            raw_audio = decode_base64_audio(req.voice.reference.audioBase64)
            norm_ref_path, _ = normalize_reference_audio(raw_audio, work_dir)

            output_wav_path = os.path.join(work_dir, "output.wav")

            # 2. الاستدلال عبر SilmaEngine
            engine = engine_instance
            if engine is None:
                from .engine import SilmaEngine
                engine = SilmaEngine()

            infer_ms, sr = engine.infer(
                ref_file=norm_ref_path,
                ref_text=req.voice.reference.refText,
                gen_text=clean_text,
                output_file=output_wav_path,
                speed=req.options.speed,
                seed=req.options.seed,
            )

            # 3. ترميز الناتج إلى Base64
            encode_start = time.perf_counter()
            audio_base64, duration_ms = encode_audio_file(output_wav_path, req.options.format)
            encode_ms = int((time.perf_counter() - encode_start) * 1000)

            total_ms = int((time.perf_counter() - total_start) * 1000)

            cold_start = getattr(engine, "is_cold_start", False)
            if hasattr(engine, "is_cold_start"):
                engine.is_cold_start = False

            return GenerateSuccess(
                requestId=req.requestId,
                audio=AudioResult(
                    base64=audio_base64,
                    format=req.options.format,
                    mimeType="audio/wav" if req.options.format == "wav" else "audio/mpeg",
                    sampleRate=sr,
                    durationMs=duration_ms,
                ),
                meta=MetaResult(
                    model="silma-tts-v1",
                    coldStart=cold_start,
                    seed=req.options.seed,
                    timings=Timings(
                        inferMs=infer_ms,
                        encodeMs=encode_ms,
                        totalMs=total_ms,
                    ),
                ),
            )

    return app
