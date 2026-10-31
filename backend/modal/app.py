"""
تطبيق Modal السحابي الموحد لاستوديو Talky لتوليد الأصوات العربية
يحتوي على:
1. الخادم المباشر FastApi (TalkyServer)
2. محرك تحويل واستدلال ONNX (export_onnx)
3. دالة الاختبار والقياس السريع (generate_sample)
كافة الوظائف تعمل تحت تطبيق واحد: talky-tts بدون إنشاء أي تطبيقات مكررة.
"""

import os
import sys
import subprocess
import modal

# التطبيق الوحيد المعتمد للمشروع
app = modal.App("talky-tts")

# مساحة التخزين الموحدة لأوزان ONNX المحولة
onnx_volume = modal.Volume.from_name("talky-onnx-weights", create_if_missing=True)

# مسار مجلد أدوات التحويل المحلي
f5_onnx_local_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "f5-tts-onnx-ref", "Export_ONNX"))

# صورة الحاوية الموحدة مع كافة المكتبات والمعالجات
talky_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git", "libsndfile1")
    .pip_install(
        "torch>=2.2.0",
        "torchaudio",
        "soundfile>=0.12.1",
        "scipy",
        "fastapi>=0.110.0",
        "pydantic>=2.0.0",
        "silma-tts",
        "f5-tts>=1.1.21",
        "vocos",
        "safetensors",
        "omegaconf",
        "pyyaml",
        "onnx>=1.17",
        "onnxruntime>=1.20",
        "onnxslim",
        "onnxconverter-common",
        "cached_path",
        "huggingface_hub",
        "pydub",
        "pypinyin",
        "jieba",
        "pyarrow<15.0.0",
    )
    .run_commands(
        "python -c \"from silma_tts.api import SilmaTTS; SilmaTTS(); print('Silma weights baked into image successfully')\""
    )
    .add_local_dir(f5_onnx_local_dir, remote_path="/opt/Export_ONNX")
    .add_local_python_source("talky")
)


# ─────────────────────────────────────────────────────────────
# 1. دالة تصدير نموذج Silma إلى ONNX وحفظه في التخزين الموحد
# ─────────────────────────────────────────────────────────────
@app.function(
    image=talky_image,
    volumes={"/vol/silma-onnx": onnx_volume},
    cpu=16.0,
    memory=16384,
    timeout=900,
)
def export_onnx(nfe_step: int = 16):
    """تصدير نموذج Silma-TTS إلى صيغة ONNX المسرعة داخل نفس تطبيق talky-tts"""
    import shutil
    import torch
    from safetensors.torch import save_file
    from cached_path import cached_path
    from huggingface_hub import snapshot_download
    from importlib.resources import files

    print("=" * 60)
    print("🚀 بدء تصدير Silma-TTS إلى صيغة ONNX في تطبيق talky-tts")
    print(f"📊 خطوات الاستدلال (NFE Steps): {nfe_step}")
    print("=" * 60)

    work_dir = "/tmp/export_workspace"
    os.makedirs(work_dir, exist_ok=True)
    out_dir = "/vol/silma-onnx"
    os.makedirs(out_dir, exist_ok=True)

    # 1. تحميل الأوزان والمفردات
    print("\n>>> [1/5] جاري تنزيل أوزان وقاموس Silma-TTS...")
    ckpt_path = str(cached_path("hf://silma-ai/silma-tts/model.pt"))
    vocab_path = str(cached_path("hf://silma-ai/silma-tts/vocab.txt"))
    dest_vocab = os.path.join(out_dir, "vocab.txt")
    shutil.copy2(vocab_path, dest_vocab)
    print(f"✅ تم حفظ قاموس المفردات في: {dest_vocab}")

    # 2. تنظيف أوزان EMA وتحويلها إلى Safetensors
    print("\n>>> [2/5] تنظيف أوزان EMA وتحويلها إلى Safetensors...")
    raw_ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    ema_dict = raw_ckpt.get("ema_model_state_dict", raw_ckpt.get("model_state_dict"))
    clean_state_dict = {
        k.replace("ema_model.", ""): v.contiguous()
        for k, v in ema_dict.items()
        if k not in ["initted", "step"] and not k.startswith("mel_spec.")
    }
    clean_safetensors_path = os.path.join(work_dir, "silma_clean.safetensors")
    save_file(clean_state_dict, clean_safetensors_path)
    print(f"✅ تم حفظ الأوزان النقية: {clean_safetensors_path}")

    # 3. إعداد config.yaml
    print("\n>>> [3/5] إعداد ملف تكوين النموذج...")
    silma_cfg_path = str(files("silma_tts").joinpath("config.yaml"))
    dest_cfg_path = os.path.join(work_dir, "config.yaml")
    shutil.copy2(silma_cfg_path, dest_cfg_path)
    shutil.copy2(silma_cfg_path, os.path.join(out_dir, "config.yaml"))

    # 4. تنزيل أوزان Vocos
    print("\n>>> [4/5] تنزيل أوزان Vocos Vocoder (24kHz)...")
    vocos_dir = os.path.join(work_dir, "vocos-mel-24khz")
    snapshot_download("charactr/vocos-mel-24khz", local_dir=vocos_dir)

    # 5. تشغيل محول ONNX
    print("\n>>> [5/5] تشغيل التحويل إلى ملفات ONNX...")
    preprocess_onnx = os.path.join(out_dir, "F5_Preprocess.onnx")
    transformer_onnx = os.path.join(out_dir, "F5_Transformer.onnx")
    decode_onnx = os.path.join(out_dir, "F5_Decode.onnx")
    metadata_onnx = os.path.join(out_dir, "F5_Metadata.onnx")

    cmd = [
        sys.executable,
        "/opt/Export_ONNX/F5_TTS/Export_F5.py",
        "--model_series", "v1",
        "--f5safetensor_path", clean_safetensors_path,
        "--vocab_path", dest_vocab,
        "--omegacfg_path", dest_cfg_path,
        "--vocosmodel_dir", vocos_dir,
        "--preprocessmodel_path", preprocess_onnx,
        "--transformermodel_path", transformer_onnx,
        "--decodermodel_path", decode_onnx,
        "--metadatamodel_path", metadata_onnx,
        "--nfe_step", str(nfe_step),
        "--skip_inference",
    ]

    proc = subprocess.run(
        cmd,
        cwd="/opt/Export_ONNX/F5_TTS",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    print("--- [مخرجات التحويل من Export_F5.py] ---")
    print(proc.stdout)
    if proc.returncode != 0:
        raise RuntimeError(f"فشلت عملية التصدير بكود الخطأ: {proc.returncode}")

    # جرد الملفات في Volume
    print("\n" + "=" * 60)
    print("📁 قائمة الملفات الناتجة في Modal Volume (/vol/silma-onnx):")
    total_size = 0
    exported_files = []
    for fname in sorted(os.listdir(out_dir)):
        fpath = os.path.join(out_dir, fname)
        if os.path.isfile(fpath):
            size_mb = os.path.getsize(fpath) / (1024 * 1024)
            total_size += size_mb
            exported_files.append({"name": fname, "size_mb": round(size_mb, 2)})
            print(f"  • {fname:25} : {size_mb:6.2f} MB")
    print(f"الإجمالي: {total_size:.2f} MB")
    print("=" * 60)

    # حفظ وتثبيت الملفات
    onnx_volume.commit()
    print("💾 تم تثبيت وحفظ الأوزان في Modal Volume بنجاح!")
    return {
        "ok": True,
        "files": exported_files,
        "total_size_mb": round(total_size, 2),
    }


# ─────────────────────────────────────────────────────────────
# 2. خادم Talky FastAPI الرئيسي (Web Server)
# ─────────────────────────────────────────────────────────────
@app.cls(
    image=talky_image,
    volumes={"/vol/silma-onnx": onnx_volume},
    cpu=16.0,  # 16 نواة فيزيائية كاملة (32 vCPUs)
    memory=16384,  # 16 جيجابايت رام
    scaledown_window=180,  # 3 دقائق إبقاء نشط بعد آخر طلب
    timeout=180,
)
class TalkyServer:
    @modal.enter()
    def setup(self):
        import torch
        torch.set_num_threads(16)
        torch.set_num_interop_threads(4)
        from talky.engine import SilmaEngine
        print(">>> [Modal Container] جاري تهيئة خادم Talky الموحد على 16 نواة...")
        self.engine = SilmaEngine()
        self.engine.is_cold_start = True

    @modal.asgi_app()
    def web(self):
        from talky.api import create_app
        return create_app(self.engine)


# ─────────────────────────────────────────────────────────────
# 3. دالة تجربة التوليد من سطر الأوامر (generate_sample)
# ─────────────────────────────────────────────────────────────
@app.function(
    image=talky_image,
    volumes={"/vol/silma-onnx": onnx_volume},
    cpu=16.0,
    memory=16384,
    timeout=180,
)
def generate_sample(text: str, ref_audio_b64: str, ref_text: str, speed: float = 1.0):
    """دالة لاختبار التوليد مباشرة من سطر الأوامر بأقصى قوة معالج"""
    import tempfile
    import torch
    torch.set_num_threads(16)
    torch.set_num_interop_threads(4)
    from talky.engine import SilmaEngine
    from talky.audio import decode_base64_audio, normalize_reference_audio, encode_audio_file

    engine = SilmaEngine()
    with tempfile.TemporaryDirectory() as work_dir:
        raw_bytes = decode_base64_audio(ref_audio_b64)
        norm_ref, _ = normalize_reference_audio(raw_bytes, work_dir)
        out_wav = os.path.join(work_dir, "generated_output.wav")

        infer_ms, sr = engine.infer(
            ref_file=norm_ref,
            ref_text=ref_text,
            gen_text=text,
            output_file=out_wav,
            speed=speed,
        )

        b64, duration_ms = encode_audio_file(out_wav)
        return {
            "inferMs": infer_ms,
            "durationMs": duration_ms,
            "sampleRate": sr,
            "audioBase64": b64,
        }


# ─────────────────────────────────────────────────────────────
# 4. نقطة الدخول المحلية الرئيسية
# ─────────────────────────────────────────────────────────────
@app.local_entrypoint()
def main(action: str = "test", text: str = "مرحباً بكم في استوديو توكي لتوليد الأصوات العربية بالذكاء الاصطناعي."):
    """
    نقطة الدخول من جهاز المستخدم:
    - لتشغيل الاختبار: modal run backend/modal/app.py
    - لتشغيل تصدير ONNX: modal run backend/modal/app.py --action export
    """
    if action == "export":
        print(">>> جاري طلب تصدير أوزان ONNX داخل تطبيق talky-tts الموحد...")
        res = export_onnx.remote(nfe_step=16)
        print("✅ اكتمل التصدير:", res)
        return

    import base64
    import time

    base_dir = os.path.dirname(__file__)
    wav_path = os.path.join(base_dir, "tests/ar.ref.24k.wav")
    if not os.path.exists(wav_path):
        wav_path = "tests/ar.ref.24k.wav"

    with open(wav_path, "rb") as f:
        ref_b64 = base64.b64encode(f.read()).decode("utf-8")

    ref_text = "ويدقق النظر في القرآن الكريم وسائر الكتب السماوية ويتبع مسالك الرسل العظام عليهم الصلاة والسلام."

    print(f">>> إرسال طلب توليد تجريبي إلى Modal (تطبيق talky-tts)...")
    start_t = time.perf_counter()
    result = generate_sample.remote(text=text, ref_audio_b64=ref_b64, ref_text=ref_text)
    total_sec = time.perf_counter() - start_t

    out_file = "output_test.wav"
    audio_bytes = base64.b64decode(result["audioBase64"])
    with open(out_file, "wb") as f:
        f.write(audio_bytes)

    print("\n" + "=" * 50)
    print(f"✅ تم التوليد بنجاح! حُفظ الملف في: {out_file}")
    print(f"وقت استدلال النموذج: {result['inferMs']} ms")
    print(f"مدة الصوت الناتج: {result['durationMs']} ms")
    print(f"الوقت الإجمالي: {total_sec:.2f} ثانية")
    print("=" * 50)
