"""
اختبار استدلال وتوليد الصوت عبر Modal من سطر الأوامر (CLI)
"""

import os
import sys
import time
import base64
import argparse
import modal

# المسار الافتراضي للعينة المرجعية
DEFAULT_REF_WAV = os.path.join(
    os.path.dirname(__file__), "..", "tests", "ar.ref.24k.wav"
)
DEFAULT_REF_TEXT = (
    "ويدقق النظر في القرآن الكريم وسائر الكتب السماوية ويتبع مسالك الرسل العظام عليهم الصلاة والسلام."
)
DEFAULT_GEN_TEXT = (
    "مرحباً بكم في استوديو توكي لتوليد الأصوات العربية بالذكاء الاصطناعي، الصوت واضح وطبيعي جداً."
)


def main():
    parser = argparse.ArgumentParser(description="اختبار توليد الصوت على Modal عبر Silma-TTS")
    parser.add_argument("--text", type=str, default=DEFAULT_GEN_TEXT, help="النص المراد توليده")
    parser.add_argument("--ref-wav", type=str, default=DEFAULT_REF_WAV, help="مسار العينة المرجعية WAV")
    parser.add_argument("--ref-text", type=str, default=DEFAULT_REF_TEXT, help="النص المرجعي للعينة")
    parser.add_argument("--speed", type=float, default=1.0, help="سرعة الإلقاء")
    parser.add_argument("--output", type=str, default="output_test.wav", help="مسار حفظ الملف الناتج")

    args = parser.parse_args()

    if not os.path.exists(args.ref_wav):
        print(f"خطأ: ملف العينة المرجعية غير موجود: {args.ref_wav}")
        sys.exit(1)

    print(f">>> قراءة العينة المرجعية: {args.ref_wav}")
    with open(args.ref_wav, "rb") as f:
        ref_b64 = base64.b64encode(f.read()).decode("utf-8")

    print(">>> الاتصال بـ Modal واستدعاء دالة التوليد...")
    print(f"النص المطلوب: '{args.text}'")
    print(f"السرعة: {args.speed}x")

    start_total = time.perf_counter()

    # استدعاء دالة Modal البعيدة
    try:
        from backend.modal.app import generate_sample
        result = generate_sample.remote(
            text=args.text,
            ref_audio_b64=ref_b64,
            ref_text=args.ref_text,
            speed=args.speed,
        )
    except ImportError:
        # عند التشغيل من داخل المجلد
        from app import generate_sample
        result = generate_sample.remote(
            text=args.text,
            ref_audio_b64=ref_b64,
            ref_text=args.ref_text,
            speed=args.speed,
        )

    total_time = time.perf_counter() - start_total

    audio_bytes = base64.b64decode(result["audioBase64"])
    with open(args.output, "wb") as f:
        f.write(audio_bytes)

    print("\n" + "=" * 50)
    print(" نجح التوليد عبر Modal!")
    print(f"حُفظ الملف في: {os.path.abspath(args.output)}")
    print(f"وقت الاستدلال للنموذج (Infer Time): {result['inferMs']} ms")
    print(f"مدة الصوت الناتج: {result['durationMs']} ms ({result['durationMs']/1000:.2f} ثوانٍ)")
    print(f"معدل العينات: {result['sampleRate']} Hz")
    print(f"الوقت الكلي للطلب (شاملاً الشبكة): {total_time:.2f} ثانية")
    print("=" * 50)


if __name__ == "__main__":
    main()
