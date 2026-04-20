import os
import shutil
import tempfile
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
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
    allow_credentials=False,  # ✅ FIXED: Cannot use credentials with * origins
    allow_methods=["*"],
    allow_headers=["*"],
)

# تأكد من وجود مجلد static
os.makedirs("static", exist_ok=True)

# نقطة الاتصال مع OmniVoice
client = Client("k2-fsa/OmniVoice")  # Initialize once at startup

@app.post("/api/generate")
async def generate_voice(
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
                
            fd, temp_audio_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            with open(temp_audio_path, "wb") as buffer:
                buffer.write(content)
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
            instruct_parts.append(dialect.split(" / ")[1].strip())  # Dialects use Chinese part
            
        instruct = ", ".join(instruct_parts) if instruct_parts else None

        result = client.predict(
            text,            # param_0: text
            language,        # param_1: language
            ref_audio_input, # param_2: ref_audio
            ref_text,        # param_3: ref_text ✅ ✅ ✅ FINAL FIX: Correct order
            instruct,        # param_4: instruct ✅ ✅ ✅ FINAL FIX: Correct order
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
            
        # إعادة الملف (fastapi ستقوم بقراءته)
        # ملاحظة: الملف المؤقت القديم سيُحذف، وoutput_path مُدار بواسطة gradio_client
        return FileResponse(path=output_path, media_type="audio/wav", filename="talky_output.wav")
        
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # تنظيف الملف المرجعي المؤقت إن وجد
        if temp_audio_path and os.path.exists(temp_audio_path):
            try:
                os.remove(temp_audio_path)
            except:
                pass

# تقديم واجهة المستخدم كملفات ثابتة (يجب أن يتم بعد تعريف مسارات API)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=7860, reload=True)