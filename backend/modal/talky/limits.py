"""
حدود وثوابت تطبيق Talky
"""

# حدود النص (تم رفع الحد الأقصى إلى 1500 حرف لمرونة أكبر)
MIN_TEXT_LENGTH = 1
MAX_TEXT_LENGTH = 1500

# حدود العينة الصوتية المرجعية (في حال استخدامها)
MIN_REF_AUDIO_DURATION_SEC = 1.0
MAX_REF_AUDIO_DURATION_SEC = 30.0

# مواصفات الصوت المستهدف القياسية
TARGET_SAMPLE_RATE = 24000
TARGET_CHANNELS = 1  # أحادي القناة (Mono)

# أقصى حجم لطلب الـ Base64 (10 ميجابايت)
MAX_PAYLOAD_BYTES = 10 * 1024 * 1024
