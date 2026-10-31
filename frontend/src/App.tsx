import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Settings,
  History,
  AlertCircle,
  ArrowDownToLine,
  AudioLines,
  Clock3,
  FileAudio,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { VoicePersona, GenerationPhase } from './domain/types';
import { ManuscriptEditor } from './features/editor/ManuscriptEditor';
import { VoiceRack } from './features/voices/VoiceRack';
import { TransportPlayer } from './features/player/TransportPlayer';
import { VoiceCloningModal } from './features/recorder/VoiceCloningModal';
import { StudioDialog } from './components/StudioDialog';
import { voiceManager } from './services/voices/VoiceManager';
import { modalClient } from './services/api/ModalClient';
import { audioService } from './services/audio/AudioService';
import { getHistory, saveHistoryItem } from './storage/db';
import type { HistoryItem } from './storage/db';

export function App() {
  const [text, setText] = useState(
    'لكلِّ كلمةٍ حكاية، ولكلِّ حكايةٍ صوت. أهلًا بك في تالكي، مساحتك لتحويل الأفكار إلى صوتٍ عربيٍّ ينبض بالحياة.'
  );
  const [speed, setSpeed] = useState<number>(1.0);
  const [format, setFormat] = useState<'wav' | 'mp3'>('wav');
  const [voices, setVoices] = useState<VoicePersona[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<VoicePersona | null>(null);
  const [phase, setPhase] = useState<GenerationPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [timings, setTimings] = useState<{ inferMs: number; totalMs: number } | undefined>();
  const [isCloningOpen, setIsCloningOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [endpointInput, setEndpointInput] = useState(modalClient.getEndpoint());
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isServerWarm, setIsServerWarm] = useState<boolean | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isGenerating = phase !== 'idle' && phase !== 'ready' && phase !== 'error';

  // تحميل الأصوات والسجل محلياً دون إيقاظ الخادم.
  useEffect(() => {
    async function init() {
      const allVoices = await voiceManager.getAllVoices();
      setVoices(allVoices);
      if (allVoices.length > 0) setSelectedVoice(allVoices[0]);
      setHistoryItems(await getHistory());
      setIsServerWarm(false);
    }
    init();
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!text.trim()) {
      setError('يرجى كتابة نص لتوليد الصوت');
      return;
    }
    if (text.length > 600) {
      setError('الحد الأقصى 600 حرف لكل مقطع. اختصر النص قبل التوليد.');
      return;
    }
    if (!selectedVoice) {
      setError('يرجى اختيار شخصية صوتية');
      return;
    }

    setError(null);
    setPhase('preparing');
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const reference = await voiceManager.getReferencePayload(selectedVoice);
      if (controller.signal.aborted) return;

      const request = {
        apiVersion: 1 as const,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        text: text.trim(),
        voice: { type: 'inline' as const, reference },
        options: { speed, format },
      };

      const result = await modalClient.generateSpeech(
        request,
        (newPhase) => {
          if (!controller.signal.aborted) setPhase(newPhase);
        },
        controller.signal
      );
      if (controller.signal.aborted) return;

      const audioUrl = audioService.base64ToBlobUrl(result.audio.base64, result.audio.mimeType);
      setGeneratedAudioUrl(audioUrl);
      setTimings({ inferMs: result.meta.timings.inferMs, totalMs: result.meta.timings.totalMs });

      // حفظ المقطع في السجل المحلي.
      const historyItem: HistoryItem = {
        id: result.requestId,
        text: text.trim(),
        voiceName: selectedVoice.name,
        audioBase64: result.audio.base64,
        durationMs: result.audio.durationMs,
        createdAt: new Date().toISOString(),
      };
      await saveHistoryItem(historyItem);
      setHistoryItems((prev) => [historyItem, ...prev]);
      setPhase('ready');
      setIsServerWarm(true);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      console.error(err);
      setError(err instanceof Error ? err.message : 'فشل التوليد');
      setPhase('error');
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  }, [text, selectedVoice, speed, format]);

  // لا يعمل الاختصار خلف النوافذ أو أثناء طلب جارٍ.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (isCloningOpen || isSettingsOpen || isHistoryOpen) return;
        event.preventDefault();
        if (!isGenerating && text.trim() && text.length <= 600) handleGenerate();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleGenerate, isGenerating, isCloningOpen, isSettingsOpen, isHistoryOpen, text]);

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setPhase('idle');
  };

  const handleVoiceCreated = async (newVoice: VoicePersona) => {
    await voiceManager.addCustomVoice(newVoice);
    setVoices(await voiceManager.getAllVoices());
    setSelectedVoice(newVoice);
  };

  const handleDeleteCustomVoice = async (id: string) => {
    await voiceManager.removeCustomVoice(id);
    const updated = await voiceManager.getAllVoices();
    setVoices(updated);
    if (selectedVoice?.id === id) setSelectedVoice(updated[0] || null);
  };

  const loadFromHistory = (item: HistoryItem) => {
    setText(item.text);
    setGeneratedAudioUrl(audioService.base64ToBlobUrl(item.audioBase64));
    setTimings(undefined);
    setIsHistoryOpen(false);
  };

  const saveEndpoint = () => {
    modalClient.setEndpoint(endpointInput);
    setIsSettingsOpen(false);
    modalClient.checkHealth().then((health) => setIsServerWarm(health.ok));
  };

  return (
    <div className="studio-app">
      <a href="#manuscript-text" className="skip-link">انتقل إلى محرر النص</a>

      <header className="studio-header">
        <div className="studio-width flex min-h-20 items-center justify-between gap-4">
          <div className="flex items-center gap-3 select-none">
            <div className="flex size-11 items-center justify-center rounded-slot border border-ink-500 bg-ink-800" aria-hidden="true">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="12" cy="8" r="2" className="fill-brass-400" />
                <circle cx="20" cy="8" r="2" className="fill-brass-400" />
                <path d="M5 16C9 16 11 23 16 23C21 23 23 16 27 16" className="stroke-paper-100" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-semibold leading-snug">تالكي<span className="ms-2 text-xs font-normal text-mist-500" lang="en">Talky</span></p>
              <p className="mt-0.5 hidden text-xs text-mist-300 sm:block">استوديو الصوت العربي</p>
            </div>
            <div className="ms-5 hidden items-center gap-2 border-s border-ink-600 ps-6 text-sm text-paper-100 xl:flex">
              <AudioLines className="size-4 text-mist-300" strokeWidth={1.75} aria-hidden="true" />
              تحويل النص إلى صوت
            </div>
          </div>

          <nav className="flex items-center gap-1.5 sm:gap-3" aria-label="أدوات الاستوديو">
            <span className="status-pill me-2 hidden md:inline-flex" title="لا يتم الاتصال بالخادم عند فتح الصفحة">
              <span className={`size-1.5 rounded-full ${isGenerating ? 'bg-brass-400 animate-pulse' : isServerWarm ? 'bg-firoz-400' : 'bg-mist-500'}`} aria-hidden="true" />
              {isGenerating ? 'الاستوديو يعمل' : isServerWarm ? 'تم الاتصال بالخادم' : 'جاهز عند الطلب'}
            </span>
            <button
              type="button"
              onClick={() => setIsHistoryOpen(true)}
              disabled={isGenerating}
              className="studio-button studio-button-ghost px-3"
              aria-label={`سجل المقاطع (${historyItems.length})`}
              aria-haspopup="dialog"
            >
              <History className="size-5" strokeWidth={1.75} aria-hidden="true" />
              <span className="hidden sm:inline">السجل</span>
              {historyItems.length > 0 && <span className="text-xs tabular-numbers">{historyItems.length}</span>}
            </button>
            <button type="button" onClick={() => setIsSettingsOpen(true)} disabled={isGenerating} className="studio-icon-button border border-ink-600 bg-ink-800" aria-label="إعدادات الاستوديو" aria-haspopup="dialog" title="إعدادات الاستوديو">
              <Settings className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </nav>
        </div>
      </header>

      <main className="studio-width studio-workspace">
        <div className="mb-7 flex items-end justify-between gap-6 sm:mb-8">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs text-mist-300">
              <Sparkles className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              مساحة للإبداع، بلغتك
            </div>
            <h1 className="font-amiri text-[34px] leading-[1.5] text-paper-100 sm:text-[42px]">امنح كلماتك صوتًا.</h1>
            <p className="mt-1 text-sm leading-7 text-mist-300">اختر نبرة، اكتب حكايتك، واترك الباقي لتالكي.</p>
          </div>
          <div className="hidden items-center gap-2 pb-2 text-xs text-mist-300 lg:flex">
            <ShieldCheck className="size-4 text-mist-500" strokeWidth={1.75} aria-hidden="true" />
            سجل مقاطعك محفوظ في متصفحك
          </div>
        </div>

        <div className="studio-grid">
          <VoiceRack
            voices={voices}
            selectedVoiceId={selectedVoice?.id || ''}
            onSelectVoice={setSelectedVoice}
            onOpenCloningModal={() => setIsCloningOpen(true)}
            onDeleteCustomVoice={handleDeleteCustomVoice}
            disabled={isGenerating}
          />

          <div className="min-w-0 space-y-4">
            {error && (
              <div role="alert" className="flex items-start justify-between gap-3 rounded-control border border-unnab-400/30 border-s-2 border-s-unnab-400 bg-ink-800 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 size-5 shrink-0 text-unnab-400" strokeWidth={1.75} aria-hidden="true" />
                  <div>
                    <p className="mb-1 text-sm font-semibold">تعذّر إكمال الطلب</p>
                    <p className="break-words text-sm leading-7 text-mist-300">{error}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setError(null)} className="studio-button studio-button-ghost shrink-0 px-2">إغلاق</button>
              </div>
            )}

            <ManuscriptEditor text={text} onChange={setText} speed={speed} onSpeedChange={setSpeed} format={format} onFormatChange={setFormat} disabled={isGenerating} />

            <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs leading-relaxed text-mist-500">
              <span className="flex items-center gap-2">
                <AudioLines className="size-4" strokeWidth={1.75} aria-hidden="true" />
                <span>النبرة المختارة: <bdi className="text-mist-300">{selectedVoice?.name || 'لم يتم الاختيار'}</bdi></span>
              </span>
              <span className="flex items-center gap-1.5">
                <ArrowDownToLine className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                استمع، ثم نزّل مقطعك
              </span>
            </div>
          </div>
        </div>
      </main>

      <TransportPlayer
        audioUrl={generatedAudioUrl}
        phase={phase}
        onGenerate={handleGenerate}
        onCancel={handleCancel}
        isTextEmpty={!text.trim() || text.length > 600 || !selectedVoice}
        timings={timings}
      />

      <VoiceCloningModal isOpen={isCloningOpen} onClose={() => setIsCloningOpen(false)} onVoiceCreated={handleVoiceCreated} />

      <StudioDialog isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} title="مكتبتك الصوتية" description="كل ما صنعته من مقاطع، محفوظ في هذا المتصفح." icon={<History className="size-5" strokeWidth={1.75} />}>
        {historyItems.length === 0 ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-slot border border-ink-600 bg-ink-900 text-mist-500">
              <FileAudio className="size-7" strokeWidth={1.25} aria-hidden="true" />
            </div>
            <h3 className="font-amiri text-2xl">حكايتك الأولى تبدأ هنا</h3>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-7 text-mist-300">بعد توليد أول مقطع، ستجده هنا لتعود إليه وتستمع متى شئت.</p>
            <button type="button" onClick={() => setIsHistoryOpen(false)} className="studio-button studio-button-secondary mt-6">العودة إلى الاستوديو</button>
          </div>
        ) : (
          <div className="space-y-3">
            {historyItems.map((item) => (
              <button key={item.id} type="button" onClick={() => loadFromHistory(item)} className="flex w-full items-center gap-4 rounded-control border border-ink-600 bg-ink-900 p-4 text-start transition-colors hover:border-ink-500 hover:bg-ink-700">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-control border border-ink-600 text-firoz-400"><FileAudio className="size-5" strokeWidth={1.75} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-amiri text-xl leading-loose">{item.text}</span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mist-300">
                    <span>بصوت: <bdi>{item.voiceName}</bdi></span>
                    <span className="flex items-center gap-1 tabular-numbers"><Clock3 className="size-3" aria-hidden="true" />{(item.durationMs / 1000).toFixed(1)} ث</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </StudioDialog>

      <StudioDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title="إعدادات الاستوديو" description="اربط استوديو تالكي بخادم توليد الصوت الخاص بك." icon={<Settings className="size-5" strokeWidth={1.75} />}>
        <form onSubmit={(event) => { event.preventDefault(); saveEndpoint(); }}>
          <label htmlFor="modal-endpoint" className="studio-field-label">رابط الخادم السحابي <span lang="en">(Modal Endpoint)</span></label>
          <input id="modal-endpoint" type="url" dir="ltr" required value={endpointInput} onChange={(event) => setEndpointInput(event.target.value)} className="studio-field text-left" aria-describedby="endpoint-note" autoComplete="off" spellCheck={false} />
          <div id="endpoint-note" className="studio-note mt-4 rounded-control border border-ink-600 bg-ink-900 p-4">
            <ShieldCheck className="mt-1 size-4 shrink-0 text-mist-500" strokeWidth={1.75} aria-hidden="true" />
            <p>يُحفظ الرابط في متصفحك. سيُفحص الاتصال عند الحفظ؛ لا نوقظ الخادم لمجرد فتح الاستوديو.</p>
          </div>
          <div className="mt-6 flex items-center justify-end gap-2 border-t border-ink-600 pt-5">
            <button type="button" onClick={() => setIsSettingsOpen(false)} className="studio-button studio-button-ghost">إلغاء</button>
            <button type="submit" className="studio-button studio-button-primary">حفظ الرابط</button>
          </div>
        </form>
      </StudioDialog>
    </div>
  );
}

export default App;
