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
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from gradio_client import Client, handle_file
import uvicorn

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

# تأكد من وجود مجلد static
os.makedirs("static", exist_ok=True)

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

@app.post("/api/generate")
async def generate_voice(
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    language: str = Form("Auto"),
    dialect: str = Form("Auto"),
    gender: str = Form("Auto"),
    role: str = Form("Auto"),
    accent: str = Form("Auto"),
    ref_text: str = Form(""),
    seed: int = Form(0),
    ref_audio: UploadFile = File(None)
):
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
        
    temp_audio_path = None
    try:
        # إذا كان هناك ملف مرجعي، نقوم بحفظه مؤقتاً
        if ref_audio is not None and ref_audio.filename:
            # Limit file size to 10MB
            max_size = 10 * 1024 * 1024  # 10MB
            content = await ref_audio.read(max_size + 1)
            
            if len(content) > max_size:
                raise HTTPException(status_code=413, detail="Reference audio file too large. Maximum 10MB allowed.")
                
            ext = os.path.splitext(ref_audio.filename)[1]
            if not ext:
                ext = ".wav"
            fd, temp_audio_path = tempfile.mkstemp(suffix=ext)
            with os.fdopen(fd, "wb") as buffer:
                await asyncio.to_thread(buffer.write, content)
            ref_audio_input = handle_file(temp_audio_path)
        else:
            ref_audio_input = None

        # Build instruction string from voice attributes
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
            
        instruct = ", ".join(instruct_parts) if instruct_parts else ""

        client = await asyncio.to_thread(get_client)
        result = await asyncio.to_thread(
            client.predict,
            text,            # param_0: text
            language,        # param_1: language
            ref_audio_input, # param_2: ref_audio
            ref_text,        # param_3: ref_text 
            instruct,        # param_4: instruct 
            32,              # param_5: ns (Number of steps)
            2.0,             # param_6: gs (Guidance Scale)
            True,            # param_7: dn
            1.0,             # param_8: sp
            None,            # param_9: du (None = auto)
            True,            # param_10: pp
            True,            # param_11: po
            fn_index=0
        )
        
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
        print(f"Error: {e}")
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

if __name__ == "__main__":
    port = int(os.getenv("PORT", 7860))
    uvicorn.run("app:app", host="0.0.0.0", port=port)