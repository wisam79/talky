import React, { useState, useRef } from 'react';
import { X, Mic, Square, Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import { audioService } from '../../services/audio/AudioService';
import type { VoicePersona } from '../../domain/types';

interface VoiceCloningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVoiceCreated: (voice: VoicePersona) => void;
}

export const VoiceCloningModal: React.FC<VoiceCloningModalProps> = ({
  isOpen,
  onClose,
  onVoiceCreated,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [refText, setRefText] = useState(
    'ويدقق النظر في القرآن الكريم وسائر الكتب السماوية ويتبع مسالك الرسل العظام عليهم الصلاة والسلام.'
  );
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number>(0);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [hasConsent, setHasConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);

  if (!isOpen) return null;

  const startRecording = async () => {
    setError(null);
    try {
      await audioService.startRecording();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = window.setInterval(() => {
        setRecordingTime((t) => {
          if (t >= 10) {
            stopRecording();
            return 10;
          }
          return t + 1;
        });
      }, 1000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل تشغيل المايكروفون');
    }
  };

  const stopRecording = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    try {
      const result = await audioService.stopRecording();
      setIsRecording(false);
      setAudioBase64(result.base64);
      setDurationSec(result.durationSec);

      if (result.durationSec < 2.5) {
        setError('العينة المسجلة قصيرة جداً (يُفضل تسجيل 4 إلى 8 ثوانٍ للحصول على أفضل دقة)');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل إيقاف التسجيل');
      setIsRecording(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    try {
      const result = await audioService.fileToBase64(file);
      setAudioBase64(result.base64);
      setDurationSec(result.durationSec);

      if (result.durationSec < 2.5) {
        setError('الملف الصوتي قصير جداً (الحد الأدنى 2.5 ثانية)');
      } else if (result.durationSec > 15) {
        setError('الملف الصوتي طويل جداً (الحد الأقصى للعينة المرجعية 15 ثانية)');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل قراءة الملف الصوتي');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('يرجى إدخال اسم الشخصية');
      return;
    }
    if (!audioBase64) {
      setError('يرجى تسجيل أو رفع عينة صوتية');
      return;
    }
    if (!refText.trim()) {
      setError('يرجى كتابة النص المطابق لما قيل في التسجيل الصوتي بدقة');
      return;
    }
    if (!hasConsent) {
      setError('يجب الموافقة على إقرار الاستخدام المسؤول');
      return;
    }

    const newVoice: VoicePersona = {
      id: `custom:${Date.now()}`,
      source: 'custom',
      name: name.trim(),
      description: description.trim() || 'صوت مخصص تم استنساخه',
      language: 'ar',
      gender,
      tags: ['مستنسخ', gender === 'male' ? 'صوت رجالي' : 'صوت نسائي'],
      audioBase64,
      refText: refText.trim(),
      createdAt: new Date().toISOString(),
    };

    onVoiceCreated(newVoice);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#10172D] border border-[#222C54] rounded-[12px] w-full max-w-lg p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute left-4 top-4 text-[#7C85A8] hover:text-[#EEEAE0] p-1 rounded-[6px]"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5 pb-3 border-b border-[#222C54]">
          <div className="w-8 h-8 rounded-[8px] bg-[#E0A93B]/10 text-[#E0A93B] flex items-center justify-center border border-[#E0A93B]/20">
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-base text-[#EEEAE0] font-plex">استنساخ نبرة صوت جديدة</h3>
            <p className="text-xs text-[#7C85A8]">سجل عينة (5 إلى 8 ثوانٍ) واستنسخ النبرة فورياً</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-[#172040] border-r-2 border-[#F0737F] border border-[#222C54] rounded-[6px] text-[#F0737F] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-plex">
          <div>
            <label htmlFor="cloning-voice-name" className="block font-semibold text-[#A9B0CB] mb-1">
              اسم الشخصية:
            </label>
            <input
              id="cloning-voice-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: سلمان الوثائقي / مريم البودكاست"
              className="w-full bg-[#0A0F1F] border border-[#222C54] rounded-[8px] px-3 py-2 text-[#EEEAE0] focus:border-[#E0A93B] outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="cloning-voice-gender" className="block font-semibold text-[#A9B0CB] mb-1">
                النوع:
              </label>
              <select
                id="cloning-voice-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as 'male' | 'female')}
                className="w-full bg-[#0A0F1F] border border-[#222C54] rounded-[8px] px-3 py-2 text-[#EEEAE0] focus:border-[#E0A93B] outline-none"
              >
                <option value="male">ذكر (صوت رجالي)</option>
                <option value="female">أنثى (صوت نسائي)</option>
              </select>
            </div>

            <div>
              <label htmlFor="cloning-voice-desc" className="block font-semibold text-[#A9B0CB] mb-1">
                الوصف:
              </label>
              <input
                id="cloning-voice-desc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="نبرة فصيحة هادئة..."
                className="w-full bg-[#0A0F1F] border border-[#222C54] rounded-[8px] px-3 py-2 text-[#EEEAE0] focus:border-[#E0A93B] outline-none"
              />
            </div>
          </div>

          {/* مساحة التسجيل وقراءة الجملة بنمط المخطوطة */}
          <div className="bg-[#0A0F1F] border border-[#222C54] rounded-[10px] p-4 text-center space-y-3">
            <p className="text-[11px] text-[#7C85A8]">
              اقرأ هذه الجملة بصوتك الطبيعي أثناء التسجيل (أو اكتب ما قيل في ملفك):
            </p>

            <div className="p-3 bg-[#10172D] border border-[#222C54] rounded-[8px]">
              <p className="font-amiri text-lg text-[#EEEAE0] leading-relaxed">
                «{refText}»
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-1">
              {!isRecording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#F0737F] hover:bg-[#C24A57] text-[#0A0F1F] text-xs font-bold rounded-[8px] transition-all cursor-pointer"
                >
                  <Mic className="w-4 h-4 fill-current" />
                  <span>بدء التسجيل الآن</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#172040] text-[#F0737F] border border-[#F0737F] text-xs font-bold rounded-[8px] animate-pulse transition-all cursor-pointer"
                >
                  <Square className="w-4 h-4 fill-current" />
                  <span>إيقاف التسجيل ({recordingTime} ثانية)</span>
                </button>
              )}

              <label className="inline-flex items-center gap-2 px-4 py-2 bg-[#172040] hover:bg-[#222C54] text-[#A9B0CB] hover:text-[#EEEAE0] text-xs font-semibold rounded-[8px] border border-[#222C54] cursor-pointer transition-colors">
                <Upload className="w-4 h-4" />
                <span>أو رفع ملف صوتي</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {audioBase64 && (
              <div className="flex items-center justify-center gap-2 text-xs text-[#38C6B5] bg-[#38C6B5]/10 border border-[#38C6B5]/30 py-1.5 px-3 rounded-[6px]">
                <CheckCircle2 className="w-4 h-4" />
                <span>جاهز للاستنساخ ({durationSec.toFixed(1)} ثانية)</span>
              </div>
            )}
          </div>

          {/* نص العينة المطابق */}
          <div>
            <label htmlFor="cloning-ref-text" className="block font-semibold text-[#A9B0CB] mb-1">
              النص المرجعي المطابق للعينة حرفياً:
            </label>
            <textarea
              id="cloning-ref-text"
              dir="auto"
              rows={2}
              value={refText}
              onChange={(e) => setRefText(e.target.value)}
              className="w-full bg-[#0A0F1F] border border-[#222C54] rounded-[8px] px-3 py-2 text-xs text-[#EEEAE0] focus:border-[#E0A93B] outline-none resize-none font-amiri text-sm"
            />
          </div>

          {/* إقرار الاستخدام المسؤول §8.8 ConsentGate */}
          <div className="flex items-start gap-2.5 p-3 bg-[#0A0F1F] border border-[#222C54] rounded-[8px]">
            <input
              type="checkbox"
              id="consent"
              checked={hasConsent}
              onChange={(e) => setHasConsent(e.target.checked)}
              className="mt-0.5 rounded accent-[#E0A93B] cursor-pointer"
            />
            <label
              htmlFor="consent"
              className="text-[11px] text-[#A9B0CB] leading-relaxed cursor-pointer select-none"
            >
              أقرّ بأن هذا الصوت صوتي، أو أن لدي موافقة موثقة من صاحبه على استنساخه.
            </label>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#222C54]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#172040] hover:bg-[#222C54] text-[#A9B0CB] rounded-[8px]"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={!hasConsent}
              className={`px-5 py-2 rounded-[8px] font-bold text-xs transition-colors ${
                hasConsent
                  ? 'bg-[#E0A93B] hover:bg-[#B8822A] text-[#0A0F1F] cursor-pointer'
                  : 'bg-[#172040] text-[#7C85A8] border border-[#222C54] cursor-not-allowed opacity-50'
              }`}
            >
              احفظ الصوت
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
