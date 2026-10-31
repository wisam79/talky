"""
حدود وثوابت تطبيق Talky
"""

# حدود النص
MIN_TEXT_LENGTH = 1
MAX_TEXT_LENGTH = 600

# حدود العينة الصوتية المرجعية
MIN_REF_AUDIO_DURATION_SEC = 2.0
MAX_REF_AUDIO_DURATION_SEC = 15.0

# مواصفات الصوت المستهدف لنموذج Silma
TARGET_SAMPLE_RATE = 24000
TARGET_CHANNELS = 1  # أحادي القناة (Mono)

# أقصى حجم لطلب الـ Base64 (5 ميجابايت)
MAX_PAYLOAD_BYTES = 5 * 1024 * 1024
