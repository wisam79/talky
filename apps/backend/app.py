import os
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ✅ اجبار استخدام المعالج فقط دون GPU
os.environ['CUDA_VISIBLE_DEVICES'] = ''
os.environ['GRADIO_CLIENT_FORCE_CPU'] = '1'

import tempfile
import asyncio
import threading
import time
import logging
from collections import defaultdict
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from gradio_client import Client, handle_file
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s [talky] %(levelname)s: %(message)s")
log = logging.getLogger("talky")

app = FastAPI(title="Talky PWA Backend")

# Allow CORS if needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False, # ✅ FIXED: Cannot use credentials with * origins
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=86400, # ✅ FIXED: Prevent double network latency by caching preflight OPTIONS
)

# تأكد من وجود مجلد static (بجانب هذا الملف بعد التنظيم: apps/backend/../../static)
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_STATIC_DIR = os.path.join(_REPO_ROOT, "static")
os.makedirs(_STATIC_DIR, exist_ok=True)

# Lazy initialization of OmniVoice client to avoid startup failures
_client = None
_client_lock = threading.Lock()

def get_client():
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                try:
                    hf_token = os.getenv("HF_TOKEN")
                    if hf_token and not hf_token.strip():
                        hf_token = None
                    _client = Client("k2-fsa/OmniVoice", token=hf_token)
                except Exception as e:
                    raise HTTPException(status_code=503, detail=f"OmniVoice API unavailable: {str(e)}")
    return _client

# ✅ Rate limiting: sliding-window per client IP (in-memory, single-process safe)
_RATE_MAX = int(os.getenv("RATE_LIMIT_MAX", "20"))        # requests
_RATE_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "3600"))  # seconds
_rate_hits: dict[str, list[float]] = defaultdict(list)
_rate_lock = threading.Lock()

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path == "/api/generate" and request.method == "POST":
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        with _rate_lock:
            hits = [t for t in _rate_hits[ip] if now - t < _RATE_WINDOW]
            _rate_hits[ip] = hits
            if len(hits) >= _RATE_MAX:
                retry_after = int(_RATE_WINDOW - (now - hits[0])) + 1
                from fastapi.responses import JSONResponse
                return JSONResponse(
                    status_code=429,
                    content={"detail": f"Too many requests. Try again in {retry_after}s."},
                    headers={"Retry-After": str(retry_after)},
                )
            hits.append(now)
    return await call_next(request)

# ✅ Allowed reference-audio types (validated by extension + MIME)
ALLOWED_AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".m4a", ".webm", ".flac", ".mp4"}
ALLOWED_AUDIO_MIMES = {
    "audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3",
    "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/webm", "audio/flac", "video/mp4",
}
OPTIONAL_API_KEY = os.getenv("API_KEY", "").strip()  # if set, clients must send X-API-Key


def _check_api_key(request: Request):
    if OPTIONAL_API_KEY:
        provided = request.headers.get("x-api-key", "")
        if provided != OPTIONAL_API_KEY:
            raise HTTPException(status_code=401, detail="Invalid or missing API key")


def _build_instruct(gender: str = "Auto", role: str = "Auto",
                    accent: str = "Auto", dialect: str = "Auto") -> str:
    """Build the OmniVoice `instruct` string from the UI voice attributes.

    Order: gender → role → accent → dialect. "Auto" values are skipped.
    Values may be "Label / ChineseLabel" — only the English label is kept.
    """
    instruct_parts = []
    if gender != "Auto":
        instruct_parts.append(gender.split(" / ")[0].strip())
    if role != "Auto":
        instruct_parts.append(role.split(" / ")[0].strip())
    if accent != "Auto":
        instruct_parts.append(accent.split(" / ")[0].strip())
    if dialect != "Auto":
        parts = dialect.split(" / ")
        instruct_parts.append(parts[1].strip() if len(parts) > 1 else parts[0].strip())
    return ", ".join(instruct_parts) if instruct_parts else ""


def _normalize_language(lang: str) -> str:
    """Map legacy UI language values to valid OmniVoice choices.
    
    OmniVoice accepts: Auto, Standard Arabic, Egyptian Arabic, Gulf Arabic, 
    Levantine Arabic, Moroccan Arabic, English, Chinese, French, Spanish, etc.
    """
    mapping = {
        "Arabic": "Standard Arabic",
        # Add more mappings if needed
    }
    return mapping.get(lang, lang)


@app.post("/api/generate")
async def generate_voice(
    request: Request,
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    language: str = Form("Auto"),
    dialect: str = Form("Auto"),
    gender: str = Form("Auto"),
    role: str = Form("Auto"),
    accent: str = Form("Auto"),
    ref_text: str = Form(""),
    speed: float = Form(1.0),
    steps: int = Form(32),
    guidance: float = Form(2.0),
    ref_audio: UploadFile = File(None)
):
    _check_api_key(request)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    # ✅ Validation ranges (matches OmniVoice limits)
    if len(text) > 5000:
        raise HTTPException(status_code=400, detail="Text too long. Maximum 5000 characters (split it into chunks).")
    speed = max(0.5, min(2.0, speed))
    steps = max(8, min(64, steps))
    guidance = max(0.5, min(5.0, guidance))
        
    temp_audio_path = None
    try:
        # إذا كان هناك ملف مرجعي، نقوم بحفظه مؤقتاً
        if ref_audio is not None and ref_audio.filename:
            # Limit file size to 10MB + validate type
            max_size = 10 * 1024 * 1024  # 10MB
            ext = os.path.splitext(ref_audio.filename)[1].lower()
            mime = (ref_audio.content_type or "").split(";")[0].strip().lower()
            if ext not in ALLOWED_AUDIO_EXTS or (mime and mime not in ALLOWED_AUDIO_MIMES):
                raise HTTPException(
                    status_code=415,
                    detail=f"Unsupported audio type. Allowed: {sorted(ALLOWED_AUDIO_EXTS)}",
                )
            content = await ref_audio.read(max_size + 1)
            
            if len(content) > max_size:
                raise HTTPException(status_code=413, detail="Reference audio file too large. Maximum 10MB allowed.")

            if not ext:
                ext = ".wav"
            fd, temp_audio_path = tempfile.mkstemp(suffix=ext)
            with os.fdopen(fd, "wb") as buffer:
                await asyncio.to_thread(buffer.write, content)
            ref_audio_input = handle_file(temp_audio_path)
        else:
            ref_audio_input = None

# Build instruction string from voice attributes
        instruct = _build_instruct(gender, role, accent, dialect)
        
        # Normalize language for OmniVoice
        norm_language = _normalize_language(language)
        
        client = await asyncio.to_thread(get_client)
        # NOTE: OmniVoice fn_index=0 has no seed input — speed/steps/guidance ARE supported.
        predict_timeout = float(os.getenv("PREDICT_TIMEOUT", "240"))
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    client.predict,
                    text,            # param_0: text
                    norm_language,   # param_1: language
                    ref_audio_input, # param_2: ref_audio
                    ref_text,        # param_3: ref_text
                    instruct,        # param_4: instruct
                    steps,           # param_5: ns (Number of steps)
                    guidance,        # param_6: gs (Guidance Scale)
                    True,            # param_7: dn
                    speed,           # param_8: sp
                    None,            # param_9: du (None = auto)
                    True,            # param_10: pp
                    True,            # param_11: po
                    fn_index=0
                ),
                timeout=predict_timeout,
            )
        except asyncio.TimeoutError:
            log.warning("OmniVoice predict timed out after %ss", predict_timeout)
            raise HTTPException(status_code=504, detail="Voice generation timed out. Please try a shorter text.")
        
        # استخراج مخرج الصوت
        output_path = None
        if isinstance(result, tuple) and len(result) > 0:
            output_path = result[0]
        elif isinstance(result, str):
            output_path = result
            
        if not output_path or not os.path.exists(output_path):
            raise HTTPException(status_code=500, detail="Failed to generate audio")
            
        def delete_output_file(path_to_delete: str):
            try:
                if os.path.exists(path_to_delete):
                    os.remove(path_to_delete)
            except OSError:
                pass

        background_tasks.add_task(delete_output_file, output_path)

        # إعادة الملف (fastapi ستقوم بقراءته وبعدها سيتم حذفه من خلال BackgroundTask)
        return FileResponse(path=output_path, media_type="audio/wav", filename="talky_output.wav")
        
    except HTTPException:
        raise
    except Exception as e:
        log.exception("generate_voice failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # تنظيف الملف المرجعي المؤقت إن وجد
        if temp_audio_path and os.path.exists(temp_audio_path):
            try:
                os.remove(temp_audio_path)
            except OSError:
                pass
                
        # تنظيف ملفات FastAPI المؤقتة
        if ref_audio is not None and hasattr(ref_audio, "close"):
            try:
                await ref_audio.close()
            except Exception:
                pass

# تقديم واجهة المستخدم كملفات ثابتة (يجب أن يتم بعد تعريف مسارات API)
@app.get("/health")
async def health_check():
    return {"status": "ok"}


# ✅ خدمة الواجهة الأمامية (مطلوبة لاختبار test_read_root وللتشغيل المحلي)
if os.path.isdir(_STATIC_DIR):
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 7860))
    uvicorn.run("apps.backend.app:app", host="0.0.0.0", port=port)