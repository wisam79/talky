import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, Download, Sparkles, X } from 'lucide-react';
import type { GenerationPhase } from '../../domain/types';

interface TransportPlayerProps {
  audioUrl: string | null;
  phase: GenerationPhase;
  onGenerate: () => void;
  onCancel?: () => void;
  isTextEmpty: boolean;
  timings?: { inferMs: number; totalMs: number };
}

export const TransportPlayer: React.FC<TransportPlayerProps> = ({
  audioUrl,
  phase,
  onGenerate,
  onCancel,
  isTextEmpty,
  timings: _timings,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const isGenerating = phase !== 'idle' && phase !== 'ready' && phase !== 'error';

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
    }

    // لغة حركات: waveColor = firoz-600 (#2A8C84), progressColor = firoz-400 (#38C6B5)
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#2A8C84',
      progressColor: '#38C6B5',
      cursorColor: '#E0A93B',
      cursorWidth: 2,
      barWidth: 3,
      barGap: 3,
      barRadius: 2,
      height: 48,
      normalize: true,
    });

    ws.load(audioUrl);

    ws.on('ready', () => {
      setDuration(ws.getDuration());
      setIsPlaying(false);
    });

    ws.on('audioprocess', () => {
      setCurrentTime(ws.getCurrentTime());
    });

    ws.on('finish', () => {
      setIsPlaying(false);
      setCurrentTime(0);
    });

    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
    };
  }, [audioUrl, phase]);

  const togglePlay = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
      setIsPlaying(wavesurferRef.current.isPlaying());
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  const downloadAudio = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `talky_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <footer className="h-[88px] bg-[#10172D] border-t border-[#222C54] sticky bottom-0 z-40 px-4 sm:px-8 flex items-center justify-between gap-4 shadow-2xl">
      {/* 1. طرف البداية (يمين في RTL): زر التوليد النحاسي */}
      <div className="shrink-0">
        {isGenerating ? (
          <button
            type="button"
            onClick={onCancel}
            className="h-[48px] px-6 bg-transparent hover:bg-[#172040] border border-[#34406E] text-[#EEEAE0] rounded-[10px] text-[15px] font-semibold transition-all inline-flex items-center gap-2"
          >
            <X className="w-4 h-4 text-[#F0737F]" />
            <span>إلغاء</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onGenerate}
            disabled={isTextEmpty}
            className={`h-[48px] px-8 bg-[#E0A93B] hover:bg-[#B8822A] active:translate-y-[1px] text-[#0A0F1F] rounded-[10px] text-[15px] font-bold shadow-lg shadow-[#E0A93B]/10 transition-all inline-flex items-center gap-2.5 font-plex ${
              isTextEmpty ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            <Sparkles className="w-4 h-4 fill-current" />
            <span>ولِّد الصوت</span>
          </button>
        )}
      </div>

      {/* 2. الجهاز الأوسط (LTR مستقل): التشغيل والموجة والزمن */}
      <div
        dir="ltr"
        className="flex-1 max-w-[720px] mx-auto flex items-center gap-4 bg-[#0A0F1F]/60 border border-[#222C54]/60 rounded-[12px] px-4 py-2 h-[64px]"
      >
        {/* زر التشغيل الدائري 44px */}
        <button
          type="button"
          onClick={togglePlay}
          disabled={!audioUrl || isGenerating}
          className={`w-[44px] h-[44px] rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 ${
            audioUrl && !isGenerating
              ? 'bg-[#172040] hover:bg-[#222C54] text-[#38C6B5] border border-[#222C54]'
              : 'bg-[#0A0F1F] text-[#7C85A8] border border-[#222C54]/50 cursor-not-allowed'
          }`}
          title={isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 fill-current" />
          ) : (
            <Play className="w-5 h-5 fill-current ml-0.5" />
          )}
        </button>

        {/* عارض القلم (Waveform) أو شريط الانتظار بالحركات */}
        <div className="flex-1 overflow-hidden relative flex items-center h-full">
          {/* حاوية WaveSurfer تبقى دائماً في الـ DOM لضمان استقرار الربط */}
          <div
            ref={containerRef}
            className={`w-full cursor-pointer ${
              !audioUrl || isGenerating ? 'hidden' : 'block'
            }`}
          />

          {/* خط أفقي رفيع بلون ink-600 عندما لا يوجد صوت وليس هناك توليد */}
          {!audioUrl && !isGenerating && (
            <div className="w-full h-[1px] bg-[#222C54]" />
          )}

          {/* علامات التشكيل المتعاقبة أثناء التوليد فوق خط الأساس */}
          {isGenerating && (
            <div className="w-full flex items-center justify-center gap-3 text-2xl font-amiri text-[#A9B0CB] select-none py-1">
              <span className="harakat-char-1">َ</span>
              <span className="harakat-char-2">ُ</span>
              <span className="harakat-char-3">ِ</span>
              <span className="harakat-char-4">ْ</span>
              <span className="harakat-char-5">ّ</span>
              <span className="text-xs font-plex text-[#E0A93B] mr-2">
                {phase === 'warming'
                  ? 'المصباح يسخن... إيقاظ الخادم'
                  : 'توليد النبرة الصوتية...'}
              </span>
            </div>
          )}
        </div>

        {/* عدّاد الزمن LTR بالأرقام الجدولية */}
        <div className="text-[13px] font-mono text-[#A9B0CB] shrink-0 tabular-numbers select-none">
          <span>{formatTime(currentTime)}</span> / <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* 3. طرف النهاية (يسار في RTL): زر تنزيل WAV */}
      <div className="shrink-0">
        <button
          type="button"
          onClick={downloadAudio}
          disabled={!audioUrl || isGenerating}
          className={`h-[40px] px-4 rounded-[8px] border border-[#222C54] text-xs font-semibold font-plex transition-colors inline-flex items-center gap-2 ${
            audioUrl && !isGenerating
              ? 'text-[#EEEAE0] hover:bg-[#172040] hover:border-[#34406E] cursor-pointer'
              : 'text-[#7C85A8] border-[#222C54]/40 cursor-not-allowed opacity-50'
          }`}
        >
          <Download className="w-4 h-4 text-[#38C6B5]" />
          <span>تنزيل WAV</span>
        </button>
      </div>
    </footer>
  );
};
