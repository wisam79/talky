import React, { useEffect, useRef, useState } from 'react';
import type { VoicePersona } from '../../domain/types';
import { AudioLines, Check, ChevronDown, Mic2, Play, Plus, Square, Trash2 } from 'lucide-react';

interface VoiceRackProps {
  voices: VoicePersona[];
  selectedVoiceId: string;
  onSelectVoice: (voice: VoicePersona) => void;
  onOpenCloningModal: () => void;
  onDeleteCustomVoice?: (id: string) => void;
  disabled?: boolean;
}

export const VoiceRack: React.FC<VoiceRackProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoice,
  onOpenCloningModal,
  onDeleteCustomVoice,
  disabled,
}) => {
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const builtinVoices = voices.filter((voice) => voice.source === 'builtin');
  const customVoices = voices.filter((voice) => voice.source === 'custom');
  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId);

  useEffect(() => () => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
    }
  }, []);

  const togglePreview = async (voice: VoicePersona) => {
    if (playingVoiceId === voice.id) {
      audioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }

    audioRef.current?.pause();
    const url = voice.sampleUrl || (voice.audioBase64 ? `data:audio/wav;base64,${voice.audioBase64}` : '');
    if (!url) return;

    const audio = new Audio(url);
    audioRef.current = audio;
    const clearPlaying = () => {
      if (audioRef.current === audio) setPlayingVoiceId(null);
    };
    audio.onended = clearPlaying;
    audio.onerror = clearPlaying;
    setPlayingVoiceId(voice.id);

    try {
      await audio.play();
    } catch {
      clearPlaying();
    }
  };

  const renderVoiceChannel = (voice: VoicePersona) => {
    const isSelected = voice.id === selectedVoiceId;
    const isPlaying = playingVoiceId === voice.id;

    return (
      <div key={voice.id} className={`voice-channel ${isSelected ? 'voice-channel-selected' : ''}`}>
        {/* الاختيار والمعاينة زران مستقلان، دون عناصر تفاعلية متداخلة. */}
        <button
          type="button"
          onClick={() => {
            onSelectVoice(voice);
            setIsExpanded(false);
          }}
          disabled={disabled}
          aria-pressed={isSelected}
          aria-label={`اختيار صوت ${voice.name}`}
          title={voice.description}
          className="flex min-h-20 min-w-0 flex-1 items-center gap-3 rounded-control px-1 text-start"
        >
          <span className={`flex size-11 shrink-0 items-center justify-center rounded-control border bg-ink-900 ${isSelected || isPlaying ? 'border-firoz-600/50 text-firoz-400' : 'border-ink-600 text-firoz-600'}`} aria-hidden="true">
            <AudioLines className={`size-6 ${isPlaying ? 'animate-pulse' : ''}`} strokeWidth={1.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-base font-semibold text-paper-100">
              <bdi className="truncate">{voice.name}</bdi>
              {isSelected && <Check className="size-3.5 shrink-0 text-mist-300" strokeWidth={2} aria-hidden="true" />}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-mist-300">
              {voice.tags?.slice(0, 2).join(' · ') || 'نبرة عربية مخصصة'}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 flex-col gap-1">
          {(voice.sampleUrl || voice.audioBase64) && (
            <button
              type="button"
              onClick={() => togglePreview(voice)}
              disabled={disabled}
              className={`studio-icon-button ${isPlaying ? 'bg-firoz-400/10 text-firoz-400' : 'border border-ink-600 bg-ink-900'}`}
              title={isPlaying ? `إيقاف عينة ${voice.name}` : `استمع إلى ${voice.name}`}
              aria-label={isPlaying ? `إيقاف عينة ${voice.name}` : `استمع إلى ${voice.name}`}
              aria-pressed={isPlaying}
            >
              {isPlaying ? <Square className="size-3.5 fill-current" aria-hidden="true" /> : <Play className="size-3.5 fill-current" aria-hidden="true" />}
            </button>
          )}
          {voice.source === 'custom' && onDeleteCustomVoice && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`هل أنت متأكد من حذف الشخصية "${voice.name}"؟`)) {
                  onDeleteCustomVoice(voice.id);
                }
              }}
              disabled={disabled}
              className="studio-icon-button hover:text-unnab-400"
              aria-label={`حذف صوت ${voice.name}`}
              title="حذف الصوت"
            >
              <Trash2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <aside className="studio-panel overflow-hidden" aria-label="مكتبة الأصوات">
      <div className="hidden items-center gap-3 border-b border-ink-600 px-5 py-4 lg:flex">
        <span className="section-step" aria-hidden="true">01</span>
        <div className="flex-1">
          <h2 className="text-base font-semibold">اختر الصوت</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-mist-300">لكل حكاية نبرتها</p>
        </div>
        <AudioLines className="size-5 text-mist-500" strokeWidth={1.5} aria-hidden="true" />
      </div>

      {/* قائمة مختصرة على الجوال، ورف دائم على سطح المكتب. */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex min-h-20 w-full items-center gap-3 p-4 text-start lg:hidden"
        aria-expanded={isExpanded}
        aria-controls="voice-rack-list"
      >
        <span className="section-step" aria-hidden="true">01</span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-mist-300">الصوت المختار</span>
          <bdi className="mt-0.5 block truncate text-base font-semibold">{selectedVoice?.name || 'اختر صوتًا'}</bdi>
        </span>
        <span className="text-xs text-mist-300">{isExpanded ? 'إخفاء الأصوات' : 'تغيير الصوت'}</span>
        <ChevronDown className={`size-4 text-mist-300 ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      <div id="voice-rack-list" className={`${isExpanded ? 'block' : 'hidden'} lg:block`}>
        <section className="px-3 pb-4 pt-4" aria-labelledby="builtin-voices-heading">
          <div className="mb-3 flex items-center justify-between px-2">
            <h3 id="builtin-voices-heading" className="text-xs font-medium text-mist-300">أصوات جاهزة</h3>
            <span className="rounded-md border border-ink-600 px-1.5 text-xs tabular-numbers text-mist-300">{builtinVoices.length}</span>
          </div>
          <div className="space-y-1.5">{builtinVoices.map(renderVoiceChannel)}</div>
        </section>

        <section className="border-t border-ink-600 p-4" aria-labelledby="custom-voices-heading">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 id="custom-voices-heading" className="text-xs font-medium text-mist-300">أصواتي</h3>
            {customVoices.length > 0 && (
              <button type="button" onClick={onOpenCloningModal} disabled={disabled} className="studio-icon-button" aria-label="إضافة صوت مخصص">
                <Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
          </div>
          {customVoices.length === 0 ? (
            <div className="rounded-control border border-dashed border-ink-500 bg-ink-900/50 p-4">
              <div className="mb-3 flex items-center gap-2.5">
                <Mic2 className="size-5 text-mist-300" strokeWidth={1.5} aria-hidden="true" />
                <p className="text-sm font-medium text-paper-100">اجعلها بصوتك</p>
              </div>
              <p className="mb-4 text-xs leading-7 text-mist-300">أضف عينة صوتية قصيرة، وامنح كلماتك نبرتك الخاصة.</p>
              <button type="button" onClick={onOpenCloningModal} disabled={disabled} className="studio-button studio-button-secondary w-full text-xs">
                <Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />
                إضافة صوت جديد
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">{customVoices.map(renderVoiceChannel)}</div>
          )}
        </section>
      </div>
    </aside>
  );
};
