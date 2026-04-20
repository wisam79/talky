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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# تأكد من وجود مجلد static
os.makedirs("static", exist_ok=True)

# نقطة الاتصال مع OmniVoice
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
            fd, temp_audio_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            with open(temp_audio_path, "wb") as buffer:
                shutil.copyfileobj(ref_audio.file, buffer)
            ref_audio_input = handle_file(temp_audio_path)
        else:
            ref_audio_input = None

        # الاتصال بالخادم
        client = Client("k2-fsa/OmniVoice")
        
        result = client.predict(
            param_0=text,
            param_1=None, # text_file
            param_2=True, # auto_detect_language
            param_3=language,
            param_4=ref_text, # ref_text_content
            param_5=ref_audio_input, # ref_audio__录音
            param_6=ref_audio_input, # ref_audio_file
            param_7=True if ref_audio_input else False, # enable_few_shots_cloning
            param_8=False, # streaming
            param_9=True, # enhance quality
            param_10=seed, # seed
            param_11=gender,
            param_12=role,
            param_13=accent,
            param_14=dialect,
            api_name="/predict"
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