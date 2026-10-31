import { useState, useEffect, useRef } from 'react';
import {
  Settings,
  History,
  AlertCircle,
} from 'lucide-react';
import type { VoicePersona, GenerationPhase } from './domain/types';
import { ManuscriptEditor } from './features/editor/ManuscriptEditor';
import { VoiceRack } from './features/voices/VoiceRack';
import { TransportPlayer } from './features/player/TransportPlayer';
import { VoiceCloningModal } from './features/recorder/VoiceCloningModal';
import { voiceManager } from './services/voices/VoiceManager';
import { modalClient } from './services/api/ModalClient';
import { audioService } from './services/audio/AudioService';
import { getHistory, saveHistoryItem } from './storage/db';
import type { HistoryItem } from './storage/db';

export function App() {
  const [text, setText] = useState(
    'أهلاً بكم في استوديو توكي؛ أحدث تقنيات توليد الصوت العربي الطبيعي واستنساخ النبرات بالذكاء الاصطناعي.'
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

  // تحميل الشخصيات وفحص حالة السيرفر عند البدء
  useEffect(() => {
    async function init() {
      const allVoices = await voiceManager.getAllVoices();
      setVoices(allVoices);
      if (allVoices.length > 0) {
        setSelectedVoice(allVoices[0]);
      }
      const history = await getHistory();
      setHistoryItems(history);

      // لا نقوم بإيقاظ السيرفر تلقائياً عند فتح الصفحة لتوفير الرصيد
      setIsServerWarm(false);
    }
    init();
  }, []);

  // اختصار لوحة المفاتيح Ctrl+Enter للتوليد السريع
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (text.trim() && phase === 'idle') {
          handleGenerate();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [text, selectedVoice, speed, format, phase]);

  const handleGenerate = async () => {
    if (!text.trim()) {
      setError('يرجى كتابة نص لتوليد الصوت');
      return;
    }
    if (!selectedVoice) {
      setError('يرجى اختيار شخصية صوتية');
      return;
    }

    setError(null);
    setPhase('preparing');
    abortControllerRef.current = new AbortController();

    try {
      const reference = await voiceManager.getReferencePayload(selectedVoice);

      const request = {
        apiVersion: 1 as const,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        text: text.trim(),
        voice: {
          type: 'inline' as const,
          reference,
        },
        options: {
          speed,
          format,
        },
      };

      const result = await modalClient.generateSpeech(
        request,
        (newPhase) => setPhase(newPhase),
        abortControllerRef.current.signal
      );

      const audioUrl = audioService.base64ToBlobUrl(result.audio.base64, result.audio.mimeType);
      setGeneratedAudioUrl(audioUrl);
      setTimings({
        inferMs: result.meta.timings.inferMs,
        totalMs: result.meta.timings.totalMs,
      });

      // حفظ في السجل المحلي
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
      console.error(err);
      setError(err instanceof Error ? err.message : 'فشل التوليد');
      setPhase('error');
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setPhase('idle');
  };

  const handleVoiceCreated = async (newVoice: VoicePersona) => {
    await voiceManager.addCustomVoice(newVoice);
    const updated = await voiceManager.getAllVoices();
    setVoices(updated);
    setSelectedVoice(newVoice);
  };

  const handleDeleteCustomVoice = async (id: string) => {
    await voiceManager.removeCustomVoice(id);
    const updated = await voiceManager.getAllVoices();
    setVoices(updated);
    if (selectedVoice?.id === id) {
      setSelectedVoice(updated[0] || null);
    }
  };

  const loadFromHistory = (item: HistoryItem) => {
    setText(item.text);
    const url = audioService.base64ToBlobUrl(item.audioBase64);
    setGeneratedAudioUrl(url);
    setTimings(undefined);
    setIsHistoryOpen(false);
  };

  const saveEndpoint = () => {
    modalClient.setEndpoint(endpointInput);
    setIsSettingsOpen(false);
    modalClient.checkHealth().then((h) => setIsServerWarm(h.ok));
  };

  return (
    <div className="min-h-screen bg-[#0A0F1F] text-[#EEEAE0] flex flex-col font-plex">
      {/* 1. الشريط العلوي (Top Bar - 56px) */}
      <header className="h-[56px] border-b border-[#222C54] bg-[#0A0F1F] px-6 flex items-center justify-between sticky top-0 z-30">
        {/* طرف البداية: الشعار وفق فلسفة «حَرَكات» */}
        <div className="flex items-center gap-3 select-none">
          {/* أيقونة حرف «ت» المخصصة: جسد الحرف موجة ونقطتاه نحاسيتان */}
          <div className="flex items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="shrink-0">
              {/* نقطتان نحاسيتان */}
              <circle cx="12" cy="8" r="2.5" fill="#E0A93B" />
              <circle cx="20" cy="8" r="2.5" fill="#E0A93B" />
              {/* جسد الحرف على شكل موجة صوتية فصيحة */}
              <path
                d="M5 16C9 16 11 23 16 23C21 23 23 16 27 16"
                stroke="#38C6B5"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            <span className="font-bold text-lg text-[#EEEAE0] tracking-wide font-plex">
              تالكي
            </span>
          </div>
          <span className="text-[11px] font-normal text-[#7C85A8] border-r border-[#222C54] pr-3 mr-1 hidden sm:inline">
            لغة التصميم «حَرَكات»
          </span>
        </div>

        {/* طرف النهاية: حالة الخادم والسجل والإعدادات */}
        <div className="flex items-center gap-3">
          {/* مصباح حالة الخادم السحابي */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#10172D] border border-[#222C54] text-[11px] text-[#A9B0CB]"
            title="حالة خادم Modal الذكي"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isServerWarm
                  ? 'bg-[#38C6B5] shadow-[0_0_8px_#38C6B5]'
                  : 'bg-[#E0A93B] animate-pulse'
              }`}
            />
            <span className="hidden sm:inline">
              {isServerWarm ? 'الخادم نشط' : 'الخادم في وضع الاستعداد'}
            </span>
          </div>

          {/* زر السجل */}
          <button
            type="button"
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
            className="h-8 px-2.5 rounded-[6px] bg-[#10172D] hover:bg-[#172040] border border-[#222C54] text-[#A9B0CB] hover:text-[#EEEAE0] text-xs transition-colors flex items-center gap-1.5"
            title="سجل المقاطع السابقة"
          >
            <History className="w-3.5 h-3.5 text-[#E0A93B]" />
            <span className="tabular-numbers">({historyItems.length})</span>
          </button>

          {/* زر الإعدادات */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="w-8 h-8 rounded-[6px] bg-[#10172D] hover:bg-[#172040] border border-[#222C54] text-[#A9B0CB] hover:text-[#EEEAE0] flex items-center justify-center transition-colors"
            title="إعدادات الرابط السحابي"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* 2. منطقة العمل الرئيسية (الصفحة في الوسط والرف على اليمين) */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* رف الأصوات (Right Side - 320px) */}
        <VoiceRack
          voices={voices}
          selectedVoiceId={selectedVoice?.id || ''}
          onSelectVoice={setSelectedVoice}
          onOpenCloningModal={() => setIsCloningOpen(true)}
          onDeleteCustomVoice={handleDeleteCustomVoice}
          disabled={phase !== 'idle' && phase !== 'ready' && phase !== 'error'}
        />

        {/* الصفحة والمحرر (Center - max 760px) */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-8 flex flex-col items-center justify-start gap-6 bg-[#0A0F1F]">
          {/* تنبيه الخطأ وفق مواصفة ErrorBanner */}
          {error && (
            <div className="w-full max-w-[760px] bg-[#172040] border-r-2 border-[#F0737F] border border-[#222C54] rounded-[6px] p-4 text-xs flex items-start justify-between gap-3 shadow-lg">
              <div className="flex items-start gap-2.5 text-[#F0737F]">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-[#EEEAE0] mb-0.5">حدث خطأ أثناء الطلب</p>
                  <p className="text-[#A9B0CB] leading-relaxed">{error}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-[#7C85A8] hover:text-[#EEEAE0]"
              >
                إغلاق
              </button>
            </div>
          )}

          {/* المحرر الورقي ManuscriptEditor */}
          <ManuscriptEditor
            text={text}
            onChange={setText}
            speed={speed}
            onSpeedChange={setSpeed}
            format={format}
            onFormatChange={setFormat}
            disabled={phase !== 'idle' && phase !== 'ready' && phase !== 'error'}
          />

          {/* شاشة السجل السريع إن كانت مفتوحة */}
          {isHistoryOpen && (
            <div className="w-full max-w-[760px] bg-[#10172D] border border-[#222C54] rounded-[8px] p-4 shadow-xl animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#222C54]">
                <h4 className="text-xs font-semibold text-[#EEEAE0] flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-[#E0A93B]" />
                  <span>سجل المقاطع المولدة محلياً</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(false)}
                  className="text-[11px] text-[#7C85A8] hover:text-[#EEEAE0]"
                >
                  إغلاق
                </button>
              </div>

              {historyItems.length === 0 ? (
                <p className="text-xs text-[#7C85A8] text-center py-4">
                  لا توجد مقاطع سابقة. قم بتوليد أول صوت وسيُحفظ هنا تلقائياً!
                </p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {historyItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => loadFromHistory(item)}
                      className="p-2.5 bg-[#0A0F1F] hover:bg-[#172040] border border-[#222C54] rounded-[6px] transition-colors cursor-pointer flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="truncate flex-1">
                        <p className="text-[#EEEAE0] font-amiri text-sm truncate">{item.text}</p>
                        <span className="text-[10px] text-[#38C6B5]">بصوت: {item.voiceName}</span>
                      </div>
                      <span className="text-[10px] text-[#7C85A8] shrink-0 font-mono">
                        {(item.durationMs / 1000).toFixed(1)}ث
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* 3. شريط النقل اللاصق بالأسفل (TransportPlayer - 88px) */}
      <TransportPlayer
        audioUrl={generatedAudioUrl}
        phase={phase}
        onGenerate={handleGenerate}
        onCancel={handleCancel}
        isTextEmpty={!text.trim()}
        timings={timings}
      />

      {/* نافذة استنساخ الصوت مع إقرار الموافقة الصريحة (§8.8 ConsentGate) */}
      <VoiceCloningModal
        isOpen={isCloningOpen}
        onClose={() => setIsCloningOpen(false)}
        onVoiceCreated={handleVoiceCreated}
      />

      {/* نافذة ضبط الرابط السحابي */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#10172D] border border-[#222C54] rounded-[10px] w-full max-w-md p-6 shadow-2xl">
            <h3 className="font-bold text-base text-[#EEEAE0] mb-2 font-plex">
              إعدادات الرابط السحابي (Modal Endpoint)
            </h3>
            <p className="text-xs text-[#A9B0CB] mb-4 leading-relaxed font-plex">
              عنوان نقطة نهاية خادم الذكاء الاصطناعي المنشور على Modal:
            </p>

            <input
              type="text"
              value={endpointInput}
              onChange={(e) => setEndpointInput(e.target.value)}
              className="w-full bg-[#0A0F1F] border border-[#222C54] rounded-[6px] px-3 py-2 text-xs font-mono text-[#EEEAE0] focus:border-[#E0A93B] outline-none mb-4"
            />

            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 bg-[#172040] hover:bg-[#222C54] text-[#A9B0CB] rounded-[6px]"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={saveEndpoint}
                className="px-5 py-2 bg-[#E0A93B] hover:bg-[#B8822A] text-[#0A0F1F] font-bold rounded-[6px]"
              >
                حفظ الرابط
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
