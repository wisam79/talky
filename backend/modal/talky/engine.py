"""
تغليف محرك Silma-TTS واستدعاء الاستدلال مع قياس الأزمنة بدقة
يدعم التبديل التلقائي إلى محرك ONNX فائق السرعة مع الحفاظ على PyTorch كاحتياطي.
"""

import os
import time
from typing import Optional, Tuple
from .errors import ModelInferenceError


class SilmaEngine:
    def __init__(self, model_dir: str = "/vol/silma-onnx"):
        self.initialized = False
        self.engine_type = "none"
        self.onnx_engine = None
        self.tts_instance = None
        self.is_cold_start = True
        self.model_dir = model_dir
        self._load_model()

    def _load_model(self):
        """تحميل محرك ONNX المسرع أولاً، أو الرجوع إلى PyTorch كبديل آمن"""
        # 1. محاولة تحميل محرك ONNX المسرع
        onnx_model_file = os.path.join(self.model_dir, "F5_Transformer.onnx")
        if os.path.exists(onnx_model_file):
            try:
                from .onnx_engine import OnnxSilmaEngine
                print(f">>> [SilmaEngine] اكتشاف أوزان ONNX في {self.model_dir}. جاري تهيئة المحرك المسرع...")
                self.onnx_engine = OnnxSilmaEngine(model_dir=self.model_dir, num_threads=16)
                self.engine_type = "onnx"
                self.initialized = True
                print(">>> [SilmaEngine] ⚡ تم تفعيل محرك ONNX فائق السرعة بنجاح!")
                return
            except Exception as e:
                print(f">>> [SilmaEngine] ⚠️ تعذر تشغيل محرك ONNX: {e}، جاري التحويل إلى PyTorch...")

        # 2. الاحتياطي: تحميل نموذج PyTorch الأصلي
        try:
            try:
                import torch
                torch.set_num_threads(16)
                torch.set_num_interop_threads(4)
            except Exception as e:
                print(f"Set threads note: {e}")

            try:
                from silma_tts.api import SilmaTTS
                self.tts_instance = SilmaTTS()
            except ImportError:
                import silma_tts
                if hasattr(silma_tts, "SilmaTTS"):
                    self.tts_instance = silma_tts.SilmaTTS()
                else:
                    self.tts_instance = None

            self.engine_type = "pytorch"
            self.initialized = True
            print(">>> [SilmaEngine] تم تحميل نموذج Silma-TTS (PyTorch) في الحاوية.")
        except Exception as e:
            print(f">>> فشل تحميل محرك الصوت: {e}")
            raise ModelInferenceError(f"فشل تحميل نموذج الصوت: {str(e)}")

    def infer(
        self,
        ref_file: str,
        ref_text: str,
        gen_text: str,
        output_file: str,
        speed: float = 1.0,
        seed: Optional[int] = None,
    ) -> Tuple[int, int]:
        """
        تشغيل الاستدلال وتوليد الموجة الصوتية.
        يعيد (infer_time_ms, sample_rate).
        """
        if self.engine_type == "onnx" and self.onnx_engine:
            infer_ms, sr = self.onnx_engine.infer(
                ref_file=ref_file,
                ref_text=ref_text,
                gen_text=gen_text,
                output_file=output_file,
                speed=speed,
                seed=seed,
            )
            self.is_cold_start = False
            return infer_ms, sr

        start_time = time.perf_counter()
        sr = 24000

        try:
            if self.tts_instance and hasattr(self.tts_instance, "infer"):
                res = self.tts_instance.infer(
                    ref_file=ref_file,
                    ref_text=ref_text,
                    gen_text=gen_text,
                    file_wave=output_file,
                    seed=seed,
                    speed=speed,
                )
            elif self.tts_instance and hasattr(self.tts_instance, "generate"):
                out = self.tts_instance.generate(
                    text=gen_text,
                    reference_audio=ref_file,
                    reference_text=ref_text,
                    speed=speed,
                )
                if hasattr(out, "save"):
                    out.save(output_file)
                res = (24000, None)
            else:
                raise RuntimeError("لم يتم العثور على دالة infer أو generate في حزمة silma_tts")

            if isinstance(res, tuple) and len(res) > 0 and isinstance(res[0], int):
                sr = res[0]

        except Exception as e:
            raise ModelInferenceError(f"خطأ أثناء معالجة النموذج: {str(e)}")

        end_time = time.perf_counter()
        infer_ms = int((end_time - start_time) * 1000)

        if not os.path.exists(output_file) or os.path.getsize(output_file) == 0:
            raise ModelInferenceError("النموذج لم يقم بإنشاء ملف صوتي صالح")

        self.is_cold_start = False
        return infer_ms, sr
