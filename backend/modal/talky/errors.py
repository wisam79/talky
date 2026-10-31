"""
فئات الأخطاء المهيكلة والرسائل المترجمة للعربية
"""

from typing import Optional, Dict, Any


class TalkyError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        message_ar: str,
        status_code: int = 400,
        retryable: bool = False,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.message_ar = message_ar
        self.status_code = status_code
        self.retryable = retryable
        self.details = details or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "messageAr": self.message_ar,
            "retryable": self.retryable,
            "details": self.details,
        }


# أخطاء محددة مسبقاً
class TextEmptyError(TalkyError):
    def __init__(self):
        super().__init__(
            code="TEXT_EMPTY",
            message="Text to generate cannot be empty",
            message_ar="النص المراد توليده لا يمكن أن يكون فارغاً",
            status_code=400,
            retryable=False,
        )


class TextTooLongError(TalkyError):
    def __init__(self, length: int, max_length: int):
        super().__init__(
            code="TEXT_TOO_LONG",
            message=f"Text length ({length}) exceeds maximum allowed ({max_length})",
            message_ar=f"طول النص ({length} حرف) تجاوز الحد الأقصى المسموح به وهو {max_length} حرف",
            status_code=400,
            retryable=False,
            details={"length": length, "maxLength": max_length},
        )


class RefAudioInvalidError(TalkyError):
    def __init__(self, reason: str = "Invalid audio format"):
        super().__init__(
            code="REF_AUDIO_INVALID",
            message=f"Reference audio is invalid: {reason}",
            message_ar=f"الملف الصوتي المرجعي غير صالح: {reason}",
            status_code=400,
            retryable=False,
        )


class RefAudioTooShortError(TalkyError):
    def __init__(self, duration: float, min_duration: float):
        super().__init__(
            code="REF_AUDIO_TOO_SHORT",
            message=f"Reference audio duration ({duration:.1f}s) is too short (min {min_duration:.1f}s)",
            message_ar=f"مدة العينة الصوتية ({duration:.1f} ثوانٍ) قصيرة جداً (الحد الأدنى {min_duration:.1f} ثوانٍ)",
            status_code=400,
            retryable=False,
            details={"duration": duration, "minDuration": min_duration},
        )


class RefAudioTooLongError(TalkyError):
    def __init__(self, duration: float, max_duration: float):
        super().__init__(
            code="REF_AUDIO_TOO_LONG",
            message=f"Reference audio duration ({duration:.1f}s) exceeds maximum ({max_duration:.1f}s)",
            message_ar=f"مدة العينة الصوتية ({duration:.1f} ثوانٍ) تجاوزت الحد الأقصى ({max_duration:.1f} ثوانٍ)",
            status_code=400,
            retryable=False,
            details={"duration": duration, "maxDuration": max_duration},
        )


class ModelInferenceError(TalkyError):
    def __init__(self, reason: str):
        super().__init__(
            code="MODEL_ERROR",
            message=f"Model inference failed: {reason}",
            message_ar="حدث خطأ داخلي أثناء توليد الصوت بالنموذج",
            status_code=500,
            retryable=True,
            details={"reason": reason},
        )
