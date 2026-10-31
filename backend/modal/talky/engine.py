"""
محرك النبرات الصوتية العصبية الفصيحة (Neural Tone Engine)
يعتمد على تقنية التوليد الصوتي العصبي الفائقة (Azure Neural / Edge-TTS)
لتوفير أعلى جودة نطق بشري عربي مع تحكم دقيق بالنبرات والسرعة ومخارج الحروف.
"""

import os
import time
import shutil
import asyncio
import subprocess
import tempfile
from typing import Optional, Tuple
from .errors import ModelInferenceError

VOICE_MAP = {
    # الشخصيات الأساسية
    "builtin:faseeh": "ar-SA-HamedNeural",    # فصيح (وثائقي / وقور)
    "builtin:nour": "ar-SA-ZariyahNeural",    # نور (روائي / تأملي / دافئ)
    "builtin:shakir": "ar-EG-ShakirNeural",   # شاكر (بودكاست / تفاعلي / معاصر)
    "builtin:salma": "ar-EG-SalmaNeural",     # سلمى (إعلانات / شبابي / حيوي)
    "builtin:fatima": "ar-AE-FatimaNeural",   # فاطمة (إخباري / إعلامي / رسمي)
    "builtin:hamdan": "ar-AE-HamdanNeural",   # حمدان (خليجي فخم / مؤثر)
    "builtin:layla": "ar-LB-LaylaNeural",     # ليلى (شامي عذب / أدبي)
    "builtin:rami": "ar-LB-RamiNeural",       # رامي (شامي دافئ / حواري)
    "builtin:salman": "ar-SA-HamedNeural",    # للتوافق القديم
    
    # أسماء مختصرة
    "faseeh": "ar-SA-HamedNeural",
    "nour": "ar-SA-ZariyahNeural",
    "shakir": "ar-EG-ShakirNeural",
    "salma": "ar-EG-SalmaNeural",
    "fatima": "ar-AE-FatimaNeural",
    "hamdan": "ar-AE-HamdanNeural",
    "layla": "ar-LB-LaylaNeural",
    "rami": "ar-LB-RamiNeural",
    "salman": "ar-SA-HamedNeural",
}


class NeuralToneEngine:
    """
    محرك استوديو Talky لتوليد الأصوات والنبرات العربية بجودة بشرية فائقة.
    """
    def __init__(self):
        self.initialized = True
        self.engine_type = "neural_azure"
        self.is_cold_start = False
        print(">>> [NeuralToneEngine] 🎙️ تم تفعيل محرك النبرات الصوتية العصبية فائقة النقاء.")

    def _resolve_voice(self, voice_id: Optional[str]) -> str:
        if not voice_id:
            return "ar-SA-HamedNeural"
        voice_clean = voice_id.strip()
        if voice_clean in VOICE_MAP:
            return VOICE_MAP[voice_clean]
        # إذا تم تمرير معرف صوت مباشر مثل ar-SA-HamedNeural
        if voice_clean.startswith("ar-"):
            return voice_clean
        return "ar-SA-HamedNeural"

    def _format_rate(self, speed: float) -> str:
        pct = int(round((speed - 1.0) * 100))
        return f"+{pct}%" if pct >= 0 else f"{pct}%"

    def _format_pitch(self, pitch: int) -> str:
        return f"+{pitch}Hz" if pitch >= 0 else f"{pitch}Hz"

    def _find_ffmpeg(self) -> str:
        exe = shutil.which("ffmpeg")
        if exe:
            return exe
        try:
            import imageio_ffmpeg
            return imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            return "ffmpeg"

    async def infer_async(
        self,
        text: str,
        voice_id: str = "builtin:faseeh",
        output_file: str = "output.wav",
        speed: float = 1.0,
        pitch: int = 0,
        **kwargs,
    ) -> Tuple[int, int]:
        """
        توليد الصوت بالنبرة المطلوبة وحفظه بصيغة PCM_16 WAV تردد 24000Hz أحادي القناة.
        يعيد (infer_time_ms, sample_rate).
        """
        import edge_tts

        start_time = time.perf_counter()
        voice_name = self._resolve_voice(voice_id)
        rate_str = self._format_rate(speed)
        pitch_str = self._format_pitch(pitch)

        temp_dir = os.path.dirname(output_file) or tempfile.gettempdir()
        temp_mp3 = os.path.join(temp_dir, f"temp_neural_{int(time.time() * 1000)}.mp3")

        try:
            comm = edge_tts.Communicate(text=text, voice=voice_name, rate=rate_str, pitch=pitch_str)
            await comm.save(temp_mp3)

            # تحويل MP3 الناتج إلى WAV PCM_16 قياسي 24kHz بقناة واحدة
            ffmpeg_exe = self._find_ffmpeg()
            cmd = [
                ffmpeg_exe,
                "-y",
                "-i", temp_mp3,
                "-vn",
                "-ar", "24000",
                "-ac", "1",
                "-c:a", "pcm_s16le",
                output_file,
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

        except Exception as e:
            raise ModelInferenceError(f"خطأ أثناء توليد الصوت العصبي: {str(e)}")
        finally:
            if os.path.exists(temp_mp3):
                try:
                    os.remove(temp_mp3)
                except Exception:
                    pass

        if not os.path.exists(output_file) or os.path.getsize(output_file) == 0:
            raise ModelInferenceError("فشل إنشاء الملف الصوتي أو أن الملف فارغ")

        end_time = time.perf_counter()
        infer_ms = int((end_time - start_time) * 1000)
        return infer_ms, 24000

    def infer(
        self,
        text: Optional[str] = None,
        voice_id: str = "builtin:faseeh",
        output_file: str = "output.wav",
        speed: float = 1.0,
        pitch: int = 0,
        ref_file: Optional[str] = None,
        ref_text: Optional[str] = None,
        gen_text: Optional[str] = None,
        seed: Optional[int] = None,
        **kwargs,
    ) -> Tuple[int, int]:
        """
        واجهة متزامنة متوافقة مع كافة أشكال الاستدعاء القديمة والجديدة
        """
        effective_text = text or gen_text or ""
        effective_voice = voice_id

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    return pool.submit(
                        asyncio.run,
                        self.infer_async(
                            text=effective_text,
                            voice_id=effective_voice,
                            output_file=output_file,
                            speed=speed,
                            pitch=pitch,
                        )
                    ).result()
        except RuntimeError:
            pass

        return asyncio.run(
            self.infer_async(
                text=effective_text,
                voice_id=effective_voice,
                output_file=output_file,
                speed=speed,
                pitch=pitch,
            )
        )


# اسم مستعار للتوافق التام مع أي واردات سابقة
SilmaEngine = NeuralToneEngine
