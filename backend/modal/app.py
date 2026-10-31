"""
تطبيق Modal السحابي الموحد لاستوديو Talky لتوليد الأصوات والنبرات العربية بجودة استوديو فائقة.
يحتوي على:
1. الخادم المباشر FastAPI (TalkyServer)
2. دالة الاختبار والقياس الفوري (generate_sample)
3. دعم المهام المتقدمة تحت تطبيق واحد موحد: talky-tts.
"""

import os
import modal

# التطبيق الموحد المعتمد للمشروع
app = modal.App("talky-tts")

# مساحة التخزين للأوزان والملفات
onnx_volume = modal.Volume.from_name("talky-onnx-weights", create_if_missing=True)

# صورة الحاوية الموحدة مع محرك النبرات العصبية وأدوات معالجة الصوت
talky_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git", "libsndfile1")
    .pip_install(
        "edge-tts>=7.0.0",
        "fastapi>=0.110.0",
        "pydantic>=2.0.0",
        "soundfile>=0.12.1",
        "scipy",
        "pydub",
        "uvicorn",
    )
    .add_local_python_source("talky")
)


# ─────────────────────────────────────────────────────────────
# 1. خادم Talky FastAPI المباشر (Web Server)
# ─────────────────────────────────────────────────────────────
@app.cls(
    image=talky_image,
    volumes={"/vol/silma-onnx": onnx_volume},
    cpu=4.0,              # 4 أنوية كافية تماماً لاستجابة لحظية فائقة السرعة
    memory=4096,          # 4 جيجابايت رام
    scaledown_window=15,  # إيقاف الحاوية تلقائياً بعد 15 ثانية لتوفير 95% من التكاليف
    timeout=120,
)
class TalkyServer:
    @modal.enter()
    def setup(self):
        from talky.engine import NeuralToneEngine
        print(">>> [Modal Container] 🎙️ تهيئة محرك النبرات الصوتية العصبية الفائقة (Azure Neural)...")
        self.engine = NeuralToneEngine()

    @modal.asgi_app()
    def web(self):
        from talky.api import create_app
        return create_app(self.engine)


# ─────────────────────────────────────────────────────────────
# 2. دالة توليد عينة صوتية للاختبار السريع (generate_sample)
# ─────────────────────────────────────────────────────────────
@app.function(
    image=talky_image,
    volumes={"/vol/silma-onnx": onnx_volume},
    cpu=2.0,
    memory=2048,
    timeout=120,
)
def generate_sample(
    text: str,
    voice_id: str = "builtin:faseeh",
    speed: float = 1.0,
    pitch: int = 0,
    ref_audio_b64: str = "",
    ref_text: str = "",
):
    """دالة اقتصادية وسريعة لتوليد الصوت مباشرة من سطر الأوامر"""
    import tempfile
    import asyncio
    from talky.engine import NeuralToneEngine
    from talky.audio import encode_audio_file

    engine = NeuralToneEngine()
    with tempfile.TemporaryDirectory() as work_dir:
        out_wav = os.path.join(work_dir, "sample.wav")
        infer_ms, sr = asyncio.run(
            engine.infer_async(
                text=text,
                voice_id=voice_id,
                output_file=out_wav,
                speed=speed,
                pitch=pitch,
            )
        )
        b64, duration_ms = encode_audio_file(out_wav)
        return {
            "inferMs": infer_ms,
            "durationMs": duration_ms,
            "sampleRate": sr,
            "audioBase64": b64,
        }


# ─────────────────────────────────────────────────────────────
# 3. دالة المهام الإضافية للتوافق (export_onnx)
# ─────────────────────────────────────────────────────────────
@app.function(
    image=talky_image,
    volumes={"/vol/silma-onnx": onnx_volume},
    cpu=2.0,
    memory=2048,
    timeout=120,
)
def export_onnx(nfe_step: int = 32):
    """دالة توافق إضافية تحت نفس تطبيق talky-tts الموحد"""
    print(">>> [talky-tts] نظام النبرات العصبية مفعل ولا يتطلب تصدير ملفات ثقيلة.")
    return {"ok": True, "engine": "neural_azure"}


# ─────────────────────────────────────────────────────────────
# 4. نقطة الدخول المحلية الرئيسية (local_entrypoint)
# ─────────────────────────────────────────────────────────────
@app.local_entrypoint()
def main(
    action: str = "test",
    text: str = "مرحباً بكم في استوديو توكي لتوليد الأصوات العربية بالذكاء الاصطناعي وبنبرات استوديو فائقة النقاء.",
    voice: str = "builtin:faseeh",
):
    """
    نقطة الدخول من جهاز المستخدم:
    - لتشغيل اختبار التوليد: modal run backend/modal/app.py
    - لاختيار شخصية محددة: modal run backend/modal/app.py --voice builtin:nour
    """
    if action == "export":
        res = export_onnx.remote()
        print("✅ نتيجة الفحص:", res)
        return

    import base64
    import time

    print(f">>> إرسال طلب توليد فوري إلى Modal (تطبيق talky-tts) للشخصية: {voice}...")
    start_t = time.perf_counter()
    result = generate_sample.remote(text=text, voice_id=voice)
    total_sec = time.perf_counter() - start_t

    out_file = "output_test.wav"
    audio_bytes = base64.b64decode(result["audioBase64"])
    with open(out_file, "wb") as f:
        f.write(audio_bytes)

    print("\n" + "=" * 55)
    print(f"🎉 تم التوليد بنجاح فائق! حُفظ الملف في: {out_file}")
    print(f"وقت استدلال النموذج: {result['inferMs']} ms")
    print(f"مدة الصوت الناتج: {result['durationMs']} ms")
    print(f"تردد الصوت: {result['sampleRate']} Hz (PCM_16 Mono)")
    print(f"الوقت الإجمالي: {total_sec:.2f} ثانية")
    print("=" * 55)
