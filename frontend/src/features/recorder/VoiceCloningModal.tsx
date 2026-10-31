import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { AlertCircle, AudioLines, Mic, ShieldCheck, Square, Upload } from 'lucide-react';
import { StudioDialog } from '../../components/StudioDialog';
import { audioService } from '../../services/audio/AudioService';
import type { VoicePersona } from '../../domain/types';

interface VoiceCloningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVoiceCreated: (voice: VoicePersona) => void;
}

type RecordingStatus = 'idle' | 'starting' | 'recording' | 'stopping';

interface RecordingSession {
  status: Exclude<RecordingStatus, 'idle'>;
  cancelled: boolean;
  timer: number | null;
}

function clearRecordingTimer(session: RecordingSession) {
  if (session.timer !== null) {
    window.clearInterval(session.timer);
    session.timer = null;
  }
}

export function VoiceCloningModal({
  isOpen,
  onClose,
  onVoiceCreated,
}: VoiceCloningModalProps) {
  const id = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [refText, setRefText] = useState(
    'ويدقق النظر في القرآن الكريم وسائر الكتب السماوية ويتبع مسالك الرسل العظام عليهم الصلاة والسلام.'
  );
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [recordingTime, setRecordingTime] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(false);
  const openRef = useRef(isOpen);
  const recordingRef = useRef<RecordingSession | null>(null);
  const uploadVersionRef = useRef(0);

  const stopRecording = useCallback(async (session = recordingRef.current) => {
    // A session can only stop once: close, the timer and the button may coincide.
    if (!session || session.status !== 'recording') return;
    session.status = 'stopping';
    clearRecordingTimer(session);
    if (mountedRef.current) setRecordingStatus('stopping');

    try {
      const result = await audioService.stopRecording();
      if (!session.cancelled && mountedRef.current && openRef.current) {
        setAudioBase64(result.base64);
        setDurationSec(result.durationSec);
        if (result.durationSec < 2.5) {
          setError('العينة المسجلة قصيرة جداً (يُفضل تسجيل 4 إلى 8 ثوانٍ للحصول على أفضل دقة)');
        }
      }
    } catch (e: unknown) {
      if (!session.cancelled && mountedRef.current && openRef.current) {
        setError(e instanceof Error ? e.message : 'فشل إيقاف التسجيل');
      }
    } finally {
      if (recordingRef.current === session) {
        recordingRef.current = null;
        if (mountedRef.current) setRecordingStatus('idle');
      }
    }
  }, []);

  const cancelAudioWork = useCallback(() => {
    uploadVersionRef.current += 1;
    if (mountedRef.current) setIsUploading(false);

    const session = recordingRef.current;
    if (!session) return;
    session.cancelled = true;
    clearRecordingTimer(session);
    // Pending permission is handled immediately when startRecording resolves.
    void stopRecording(session);
  }, [stopRecording]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    openRef.current = isOpen;
    if (!isOpen) cancelAudioWork();

    return () => {
      mountedRef.current = false;
      openRef.current = false;
      cancelAudioWork();
    };
  }, [isOpen, cancelAudioWork]);

  const handleClose = () => {
    openRef.current = false;
    cancelAudioWork();
    onClose();
  };

  const startRecording = async () => {
    if (recordingRef.current || isUploading || !openRef.current) return;

    const session: RecordingSession = { status: 'starting', cancelled: false, timer: null };
    recordingRef.current = session;
    setError(null);
    setRecordingTime(0);
    setRecordingStatus('starting');

    try {
      await audioService.startRecording();
      session.status = 'recording';
      if (session.cancelled || !mountedRef.current || !openRef.current) {
        session.cancelled = true;
        await stopRecording(session);
        return;
      }

      setRecordingStatus('recording');
      const startedAt = Date.now();
      session.timer = window.setInterval(() => {
        const elapsed = Math.min(10, Math.floor((Date.now() - startedAt) / 1000));
        setRecordingTime(elapsed);
        if (elapsed >= 10) void stopRecording(session);
      }, 1000);
    } catch (e: unknown) {
      if (!session.cancelled && mountedRef.current && openRef.current) {
        setError(e instanceof Error ? e.message : 'فشل تشغيل الميكروفون');
      }
      if (recordingRef.current === session) {
        recordingRef.current = null;
        if (mountedRef.current) setRecordingStatus('idle');
      }
    }
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || recordingRef.current || !openRef.current) return;

    const version = ++uploadVersionRef.current;
    setError(null);
    setIsUploading(true);
    try {
      const result = await audioService.fileToBase64(file);
      if (!mountedRef.current || !openRef.current || version !== uploadVersionRef.current) return;
      setAudioBase64(result.base64);
      setDurationSec(result.durationSec);

      if (result.durationSec < 2.5) {
        setError('الملف الصوتي قصير جداً (الحد الأدنى 2.5 ثانية)');
      } else if (result.durationSec > 15) {
        setError('الملف الصوتي طويل جداً (الحد الأقصى للعينة المرجعية 15 ثانية)');
      }
    } catch (e: unknown) {
      if (mountedRef.current && openRef.current && version === uploadVersionRef.current) {
        setError(e instanceof Error ? e.message : 'فشل قراءة الملف الصوتي');
      }
    } finally {
      if (mountedRef.current && version === uploadVersionRef.current) setIsUploading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (recordingRef.current || isUploading) return;
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
    handleClose();
  };

  const isRecording = recordingStatus === 'recording';
  const isAudioBusy = recordingStatus !== 'idle' || isUploading;
  const sampleStatus = recordingStatus === 'starting'
    ? 'بانتظار إذن الميكروفون…'
    : isRecording
      ? 'التسجيل جارٍ. اقرأ الجملة بصوتك الطبيعي.'
      : recordingStatus === 'stopping'
        ? 'جارٍ تجهيز العينة المسجلة…'
        : isUploading
          ? 'جارٍ قراءة الملف الصوتي…'
          : audioBase64
            ? 'العينة الصوتية مرفقة.'
            : 'لم تُضف عينة صوتية بعد.';

  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={handleClose}
      title="أضف صوتك إلى الاستوديو"
      description="جهّز عينة مرجعية ونصها المطابق لحفظ صوت مخصص تستخدمه لاحقاً في التوليد."
      icon={<Mic size={20} strokeWidth={1.75} />}
      wide
    >
      <form onSubmit={handleSubmit} noValidate className="min-w-0 space-y-6 text-sm leading-loose">
        {error && (
          <div
            role="alert"
            className="flex min-w-0 items-start gap-3 rounded-control border border-ink-600 border-s-2 border-s-unnab-400 bg-ink-700 p-4 text-paper-100"
          >
            <AlertCircle size={20} strokeWidth={1.75} className="mt-1 shrink-0 text-unnab-400" aria-hidden="true" />
            <p className="min-w-0 break-words">{error}</p>
          </div>
        )}

        <section aria-labelledby={`${id}-identity`} className="min-w-0 space-y-4">
          <div className="flex items-center gap-3">
            <span className="section-step" aria-hidden="true">01</span>
            <h3 id={`${id}-identity`} className="font-amiri text-2xl font-bold leading-[1.8]">هوية الصوت</h3>
          </div>
          <div>
            <label htmlFor={`${id}-name`} className="studio-field-label">اسم الشخصية</label>
            <input
              id={`${id}-name`}
              type="text"
              dir="auto"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="مثال: سلمان الوثائقي"
              className="studio-field [unicode-bidi:plaintext]"
            />
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={`${id}-gender`} className="studio-field-label">نوع الصوت</label>
              <select
                id={`${id}-gender`}
                value={gender}
                onChange={(event) => setGender(event.target.value as 'male' | 'female')}
                className="studio-field"
              >
                <option value="male">ذكر (صوت رجالي)</option>
                <option value="female">أنثى (صوت نسائي)</option>
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-description`} className="studio-field-label">الوصف (اختياري)</label>
              <input
                id={`${id}-description`}
                type="text"
                dir="auto"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="نبرة فصيحة هادئة"
                className="studio-field [unicode-bidi:plaintext]"
              />
            </div>
          </div>
        </section>

        <section aria-labelledby={`${id}-reference`} className="min-w-0 space-y-4 border-t border-ink-600 pt-6">
          <div className="flex items-center gap-3">
            <span className="section-step" aria-hidden="true">02</span>
            <h3 id={`${id}-reference`} className="font-amiri text-2xl font-bold leading-[1.8]">العينة المرجعية</h3>
          </div>
          <p className="studio-note">
            سجّل في مكان هادئ بصوت طبيعي، أو ارفع ملفاً بلا موسيقى. يُفضّل أن تكون العينة من 4 إلى 8 ثوانٍ.
          </p>
          <div className="min-w-0 space-y-2 rounded-slot border border-ink-600 bg-ink-900 p-4">
            <p className="text-[13px] text-mist-300">جملة القراءة — يمكنك تعديلها في قسم النص المطابق أدناه</p>
            <p dir="auto" lang="ar" className="break-words font-amiri text-xl leading-[2.1] text-paper-100 [unicode-bidi:plaintext]">
              {refText.trim() ? `«${refText}»` : 'اكتب النص المطابق أدناه، ثم اقرأه أثناء التسجيل.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => { void (isRecording ? stopRecording() : startRecording()); }}
              disabled={recordingStatus === 'starting' || recordingStatus === 'stopping' || isUploading}
              aria-describedby={`${id}-sample-hint`}
              className={`studio-button w-full sm:w-auto ${
                isRecording
                  ? 'border-unnab-400 bg-ink-700 text-unnab-400 hover:bg-unnab-400/10'
                  : 'studio-button-secondary'
              }`}
            >
              {isRecording
                ? <Square size={20} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                : <Mic size={20} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />}
              <span>{isRecording ? 'إيقاف التسجيل' : audioBase64 ? 'إعادة التسجيل' : 'بدء التسجيل'}</span>
            </button>
            <label
              htmlFor={`${id}-upload`}
              className={`studio-button studio-button-secondary relative w-full focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-paper-100 sm:w-auto ${isAudioBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              <Upload size={20} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
              <span>رفع ملف صوتي</span>
              <input
                id={`${id}-upload`}
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                disabled={isAudioBusy}
                aria-describedby={`${id}-sample-hint`}
                className="sr-only"
              />
            </label>
            {isRecording && (
              <span role="timer" aria-label="مدة التسجيل" dir="ltr" className="tabular-nums text-sm text-unnab-400">
                00:{String(recordingTime).padStart(2, '0')} / 00:10
              </span>
            )}
          </div>

          <p id={`${id}-sample-hint`} className="text-[13px] leading-loose text-mist-500">
            يتوقف التسجيل تلقائياً بعد 10 ثوانٍ. مدة الملف المرفوع بين 2.5 و15 ثانية.
          </p>
          <div
            id={`${id}-sample-status`}
            role="status"
            aria-atomic="true"
            className={`flex min-w-0 items-start gap-2 text-[13px] ${isRecording ? 'text-unnab-400' : audioBase64 && !isAudioBusy ? 'text-firoz-400' : 'text-mist-300'}`}
          >
            <AudioLines size={20} strokeWidth={1.75} className="mt-1 shrink-0" aria-hidden="true" />
            <p className="min-w-0 break-words">
              {sampleStatus}
              {audioBase64 && !isAudioBusy && Number.isFinite(durationSec) && (
                <> المدة: <bdi className="tabular-nums">{durationSec.toFixed(1)}</bdi> ثانية.</>
              )}
            </p>
          </div>
        </section>

        <section aria-labelledby={`${id}-transcript`} className="min-w-0 space-y-4 border-t border-ink-600 pt-6">
          <div className="flex items-center gap-3">
            <span className="section-step" aria-hidden="true">03</span>
            <h3 id={`${id}-transcript`} className="font-amiri text-2xl font-bold leading-[1.8]">النص المطابق</h3>
          </div>
          <p id={`${id}-transcript-hint`} className="studio-note">
            اكتب الكلمات كما نُطقت في العينة، دون إضافة أو حذف. إذا رفعت ملفاً، استبدل جملة القراءة بنصه.
          </p>
          <div>
            <label htmlFor={`${id}-ref-text`} className="studio-field-label">النص المرجعي المطابق للعينة حرفياً</label>
            <textarea
              id={`${id}-ref-text`}
              dir="auto"
              lang="ar"
              rows={3}
              required
              value={refText}
              onChange={(event) => setRefText(event.target.value)}
              aria-describedby={`${id}-transcript-hint`}
              className="studio-field min-h-32 resize-y font-amiri text-xl leading-[2.1] [unicode-bidi:plaintext]"
            />
          </div>
        </section>

        <section aria-labelledby={`${id}-responsibility`} className="min-w-0 space-y-4 border-t border-ink-600 pt-6">
          <div className="flex items-center gap-3">
            <span className="section-step" aria-hidden="true">04</span>
            <h3 id={`${id}-responsibility`} className="font-amiri text-2xl font-bold leading-[1.8]">الاستخدام المسؤول</h3>
          </div>
          <label
            htmlFor={`${id}-consent`}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control border border-ink-600 bg-ink-900 p-4 focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-paper-100"
          >
            <span className="flex min-h-11 shrink-0 items-center">
              <input
                id={`${id}-consent`}
                type="checkbox"
                required
                checked={hasConsent}
                onChange={(event) => setHasConsent(event.target.checked)}
                aria-describedby={`${id}-consent-hint`}
                className="size-5 cursor-pointer accent-brass-400"
              />
            </span>
            <span className="min-w-0 py-2 text-sm leading-loose text-paper-100">
              أقرّ بأن هذا الصوت صوتي، أو أن لدي موافقة موثقة من صاحبه على استنساخه.
            </span>
          </label>
          <p id={`${id}-consent-hint`} className="studio-note">
            <ShieldCheck size={20} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>الموافقة على الإقرار مطلوبة قبل حفظ الصوت.</span>
          </p>
        </section>

        <div className="space-y-4 border-t border-ink-600 pt-6">
          <p className="studio-note">ستظهر الشخصية في «أصواتي» لاختيارها عند توليد الكلام من المحرّر.</p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={handleClose} className="studio-button studio-button-secondary w-full sm:w-auto">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={!hasConsent || isAudioBusy}
              aria-describedby={!hasConsent ? `${id}-consent-hint` : isAudioBusy ? `${id}-sample-status` : undefined}
              className="studio-button studio-button-primary w-full disabled:border-ink-500 disabled:bg-ink-700 disabled:text-mist-300 disabled:opacity-100 sm:w-auto"
            >
              احفظ الصوت
            </button>
          </div>
        </div>
      </form>
    </StudioDialog>
  );
}
