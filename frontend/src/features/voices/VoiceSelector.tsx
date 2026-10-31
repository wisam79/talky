import React, { useState } from 'react';
import type { VoicePersona } from '../../domain/types';
import { Mic, Volume2, Square, Plus, Trash2 } from 'lucide-react';

interface VoiceSelectorProps {
  voices: VoicePersona[];
  selectedVoiceId: string;
  onSelectVoice: (voice: VoicePersona) => void;
  onOpenCloningModal: () => void;
  onDeleteCustomVoice?: (id: string) => void;
  disabled?: boolean;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoice,
  onOpenCloningModal,
  onDeleteCustomVoice,
  disabled,
}) => {
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Mic className="w-4 h-4 text-purple-400" />
          <span>اختر الشخصية الصوتية (أو استنسخ نبرة جديدة):</span>
        </label>

        <button
          type="button"
          onClick={onOpenCloningModal}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg shadow-sm shadow-purple-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>استنساخ صوت جديد</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {voices.map((voice) => {
          const isSelected = voice.id === selectedVoiceId;
          const isPlaying = playingVoiceId === voice.id;

          return (
            <div
              key={voice.id}
              onClick={() => !disabled && onSelectVoice(voice)}
              className={`relative group rounded-xl p-3.5 border transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'bg-purple-950/40 border-purple-500/80 shadow-md shadow-purple-500/10 ring-1 ring-purple-500/50'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                        isSelected
                          ? 'bg-purple-500 text-white'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {voice.gender === 'female' ? '♀' : '♂'}
                    </span>
                    <div>
                      <h4 className="font-semibold text-sm text-slate-100 flex items-center gap-1.5">
                        {voice.name}
                        {voice.source === 'custom' && (
                          <span className="text-[10px] bg-indigo-900/50 text-indigo-300 border border-indigo-700/40 px-1.5 py-0.2 rounded-full">
                            مستنسخ
                          </span>
                        )}
                      </h4>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* زر الاستماع للعينة المرجعية */}
                    {(voice.sampleUrl || voice.audioBase64) && (
                      <button
                        type="button"
                        onClick={(e) => togglePreview(voice, e)}
                        className={`p-1.5 rounded-lg text-xs transition-colors ${
                          isPlaying
                            ? 'bg-purple-600 text-white animate-pulse'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                        }`}
                        title={isPlaying ? 'إيقاف المعاينة' : 'استماع لعينة الصوت'}
                      >
                        {isPlaying ? (
                          <Square className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}

                    {/* زر حذف الشخصية المخصصة */}
                    {voice.source === 'custom' && onDeleteCustomVoice && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`هل أنت متأكد من حذف الشخصية "${voice.name}"؟`)) {
                            onDeleteCustomVoice(voice.id);
                          }
                        }}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors"
                        title="حذف هذه الشخصية"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {voice.description && (
                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mt-1">
                    {voice.description}
                  </p>
                )}
              </div>

              {/* الوسوم Tags */}
              <div className="flex flex-wrap gap-1 mt-3 pt-2 border-t border-slate-800/60">
                {voice.tags?.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] bg-slate-800/80 text-slate-400 px-2 py-0.5 rounded-md"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
