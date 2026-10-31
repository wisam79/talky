import React, { useState } from 'react';
import type { VoicePersona } from '../../domain/types';
import { Play, Square, Plus, Trash2 } from 'lucide-react';

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
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  const builtinVoices = voices.filter((v) => v.source === 'builtin');
  const customVoices = voices.filter((v) => v.source === 'custom');

  const togglePreview = (voice: VoicePersona, e: React.MouseEvent) => {
    e.stopPropagation();

    if (playingVoiceId === voice.id) {
      audioElement?.pause();
      setPlayingVoiceId(null);
      return;
    }

    if (audioElement) {
      audioElement.pause();
    }

    let url = '';
    if (voice.sampleUrl) {
      url = voice.sampleUrl;
    } else if (voice.audioBase64) {
      url = `data:audio/wav;base64,${voice.audioBase64}`;
    }

    if (!url) return;

    const audio = new Audio(url);
    audio.onended = () => setPlayingVoiceId(null);
    audio.onerror = () => setPlayingVoiceId(null);
    audio.play();

    setAudioElement(audio);
    setPlayingVoiceId(voice.id);
  };

  const renderVoiceChannel = (voice: VoicePersona) => {
    const isSelected = voice.id === selectedVoiceId;
    const isPlaying = playingVoiceId === voice.id;

    return (
      <div
        key={voice.id}
        onClick={() => !disabled && onSelectVoice(voice)}
        className={`h-[72px] px-3.5 flex items-center justify-between gap-3 transition-colors cursor-pointer select-none ${
          isSelected
            ? 'bg-[#172040] rounded-[12px] border-r-2 border-[#E0A93B]'
            : 'border-b border-[#222C54] hover:bg-[#172040]/50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {/* بصمة الصوت (Voice Fingerprint) + الاسم */}
        <div className="flex items-center gap-3 overflow-hidden flex-1">
          {/* بصمة الموجة المصغرة 56x32px */}
          <div
            className={`w-[56px] h-[32px] rounded-[4px] bg-[#0A0F1F] flex items-center justify-center px-1.5 shrink-0 border border-[#222C54] ${
              isSelected ? 'border-[#38C6B5]/40' : ''
            }`}
          >
            <div className="flex items-center gap-[2.5px] h-full py-1.5">
              {[40, 75, 55, 90, 60, 80, 45, 95, 70, 50].map((h, i) => (
                <div
                  key={i}
                  style={{ height: `${h}%` }}
                  className={`w-[2px] rounded-full transition-colors ${
                    isSelected ? 'bg-[#38C6B5]' : 'bg-[#2A8C84]'
                  } ${isPlaying ? 'animate-pulse' : ''}`}
                />
              ))}
            </div>
          </div>

          {/* تفاصيل الشخصية */}
          <div className="overflow-hidden truncate">
            <h4 className="font-semibold text-[15px] text-[#EEEAE0] truncate font-plex">
              {voice.name}
            </h4>
            <p className="text-[12px] text-[#7C85A8] truncate font-plex">
              {voice.description || 'صوت بشري فصيح'}
            </p>
          </div>
        </div>

        {/* أزرار التحكم (استمع / حذف) */}
        <div className="flex items-center gap-1 shrink-0">
          {(voice.sampleUrl || voice.audioBase64) && (
            <button
              type="button"
              onClick={(e) => togglePreview(voice, e)}
              className={`w-9 h-9 rounded-[8px] flex items-center justify-center transition-colors text-xs ${
                isPlaying
                  ? 'bg-[#E0A93B] text-[#0A0F1F]'
                  : 'text-[#A9B0CB] hover:bg-[#222C54] hover:text-[#EEEAE0]'
              }`}
              title={isPlaying ? 'إيقاف المعاينة' : 'استمع للعينة'}
            >
              {isPlaying ? (
                <Square className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
              )}
            </button>
          )}

          {voice.source === 'custom' && onDeleteCustomVoice && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`هل أنت متأكد من حذف الشخصية "${voice.name}"؟`)) {
                  onDeleteCustomVoice(voice.id);
                }
              }}
              className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[#7C85A8] hover:text-[#F0737F] hover:bg-[#F0737F]/10 transition-colors"
              title="حذف الصوت"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <aside className="w-full lg:w-[320px] bg-[#10172D] border-l border-[#222C54] flex flex-col shrink-0 h-full overflow-y-auto">
      {/* أصوات جاهزة */}
      <div className="p-4 border-b border-[#222C54]/80">
        <h3 className="text-[13px] font-semibold text-[#A9B0CB] mb-2 font-plex">
          أصوات جاهزة
        </h3>
        <div className="space-y-1">{builtinVoices.map(renderVoiceChannel)}</div>
      </div>

      {/* أصواتي */}
      <div className="p-4 flex-1">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-[#A9B0CB] font-plex">
            أصواتي
          </h3>
          <button
            type="button"
            onClick={onOpenCloningModal}
            disabled={disabled}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#E0A93B] hover:text-[#B8822A] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>صوت جديد</span>
          </button>
        </div>

        {customVoices.length === 0 ? (
          <div className="text-center py-8 px-4 border border-dashed border-[#222C54] rounded-[8px]">
            <p className="text-[12px] text-[#7C85A8] leading-relaxed mb-3">
              لم تسجل صوتاً مخصصاً بعد. استنسخ نبرتك الخاصة في 5 ثوانٍ!
            </p>
            <button
              type="button"
              onClick={onOpenCloningModal}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#172040] hover:bg-[#222C54] text-[#E0A93B] rounded-[6px] text-xs font-semibold border border-[#222C54] transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ استنساخ نبرة جديدة</span>
            </button>
          </div>
        ) : (
          <div className="space-y-1">{customVoices.map(renderVoiceChannel)}</div>
        )}
      </div>
    </aside>
  );
};
