import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, Download, Sparkles, X, Headphones } from 'lucide-react';
import type { GenerationPhase } from '../../domain/types';

interface TransportPlayerProps {
  audioUrl: string | null;
  phase: GenerationPhase;
  onGenerate: () => void;
  onCancel?: () => void;
  isTextEmpty: boolean;
  timings?: { inferMs: number; totalMs: number };
}

const PHASE_LABELS: Record<GenerationPhase, string> = {
  idle: 'مساحة الاستماع',
  preparing: 'تجهيز النص والنبرة…',
  connecting: 'الاتصال بخادم الصوت…',
  warming: 'إيقاظ خادم الصوت… قد يستغرق قليلًا',
  generating: 'كلماتك تتحوّل إلى صوت…',
  decoding: 'تجهيز المقطع للاستماع…',
  ready: 'مقطعك جاهز للاستماع',
  error: 'يمكنك المحاولة مجددًا',
};

export const TransportPlayer: React.FC<TransportPlayerProps> = ({
  audioUrl,
  phase,
  onGenerate,
  onCancel,
  isTextEmpty,
  timings,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const isGenerating = phase !== 'idle' && phase !== 'ready' && phase !== 'error';

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    // ألوان الموجة من رموز التصميم نفسها، دون تغيير معالجة الصوت.
    const styles = getComputedStyle(document.documentElement);
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: styles.getPropertyValue('--color-firoz-600').trim(),
      progressColor: styles.getPropertyValue('--color-firoz-400').trim(),
      cursorColor: styles.getPropertyValue('--color-brass-400').trim(),
      cursorWidth: 2,
      barWidth: 2,
      barGap: 3,
      barRadius: 2,
      height: 40,
      normalize: true,
    });
    let disposed = false;
    wavesurferRef.current = ws;

    ws.on('load', () => {
      setIsAudioReady(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setPlaybackError(null);
    });
    ws.on('ready', () => {
      setDuration(ws.getDuration());
      setIsAudioReady(true);
    });
    ws.on('timeupdate', (time) => setCurrentTime(time));
    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));
    ws.on('error', () => {
      if (!disposed) {
        setIsAudioReady(false);
        setPlaybackError('تعذّر تشغيل المقطع. يمكنك تنزيله والمحاولة في مشغّل آخر.');
      }
    });
    void ws.load(audioUrl).catch(() => {
      if (!disposed) setPlaybackError('تعذّر تحميل المعاينة الصوتية.');
    });

    return () => {
      disposed = true;
      wavesurferRef.current = null;
      ws.destroy();
    };
  }, [audioUrl]);

  useEffect(() => {
    if (isGenerating) wavesurferRef.current?.pause();
  }, [isGenerating]);

  const togglePlay = async () => {
    try {
      await wavesurferRef.current?.playPause();
    } catch {
      setPlaybackError('تعذّر تشغيل المقطع. حاول الضغط على التشغيل مرة أخرى.');
    }
  };

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  };

  const downloadAudio = () => {
    if (!audioUrl) return;
    const anchor = document.createElement('a');
    anchor.href = audioUrl;
    anchor.download = `talky_${Date.now()}.wav`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  return (
    <footer className="studio-transport" aria-label="توليد الصوت والاستماع">
      <div className="studio-width">
        <div className="mb-3 flex items-center justify-between gap-3 text-xs">
          <p className="flex min-w-0 items-center gap-2 text-mist-300" role="status" aria-live="polite">
            <Headphones className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span>{playbackError || (audioUrl && !isGenerating && phase === 'idle' ? 'مقطعك جاهز للاستماع' : PHASE_LABELS[phase])}</span>
          </p>
          {timings && !isGenerating ? (
            <span className="hidden shrink-0 text-mist-300 sm:inline">زمن التوليد <span className="tabular-numbers">{(timings.totalMs / 1000).toFixed(1)}</span> ث</span>
          ) : (
            <span className="hidden shrink-0 text-mist-500 sm:inline">من النص إلى النبرة، في مساحة واحدة</span>
          )}
        </div>

        <div className="transport-controls">
          <div>
            {isGenerating ? (
              <button type="button" onClick={onCancel} className="studio-button studio-button-secondary min-h-12 w-full">
                <X className="size-4 text-unnab-400" strokeWidth={1.75} aria-hidden="true" />
                إلغاء التوليد
              </button>
            ) : (
              <button type="button" onClick={onGenerate} disabled={isTextEmpty} className="studio-button studio-button-primary min-h-12 w-full gap-3">
                <Sparkles className="size-4" strokeWidth={1.75} aria-hidden="true" />
                <span>ولِّد الصوت</span>
                <kbd className="ms-auto hidden border-s border-ink-900/20 ps-3 text-xs font-normal opacity-70 lg:inline" dir="ltr" title="Ctrl أو Command + Enter">↵</kbd>
              </button>
            )}
          </div>

          <div dir="ltr" className="transport-timeline">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!audioUrl || !isAudioReady || isGenerating}
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-ink-600 bg-ink-700 text-firoz-400 transition-colors hover:bg-ink-600"
              aria-label={isPlaying ? 'إيقاف مؤقت' : 'تشغيل المقطع'}
              title={isPlaying ? 'إيقاف مؤقت' : 'تشغيل المقطع'}
            >
              {isPlaying ? <Pause className="size-4 fill-current" aria-hidden="true" /> : <Play className="ms-0.5 size-4 fill-current" aria-hidden="true" />}
            </button>

            <div className="relative flex h-10 min-w-0 flex-1 items-center overflow-hidden">
              {/* الحاوية تبقى في DOM وبعرضها الكامل، حتى أثناء الانتظار. */}
              <div ref={containerRef} className={`w-full ${!audioUrl || isGenerating ? 'invisible' : 'visible'}`} />
              {!audioUrl && !isGenerating && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  <span className="absolute inset-x-0 h-px bg-ink-600" />
                  <span className="relative bg-ink-900 px-3 text-xs text-mist-500" dir="rtl">صوتك يبدأ من هنا</span>
                </div>
              )}
              {isGenerating && (
                <div className="absolute inset-0 flex items-center justify-center gap-3 font-amiri text-2xl text-brass-400" aria-hidden="true">
                  <span className="harakat-char-1">ـَ</span>
                  <span className="harakat-char-2">ـُ</span>
                  <span className="harakat-char-3">ـِ</span>
                  <span className="harakat-char-4">ـْ</span>
                  <span className="harakat-char-5">ـّ</span>
                </div>
              )}
            </div>

            <div className="shrink-0 select-none whitespace-nowrap text-xs tabular-numbers text-mist-300">
              <span className="text-paper-100">{formatTime(currentTime)}</span><span className="mx-1.5 text-mist-500">/</span><span>{formatTime(duration)}</span>
            </div>
          </div>

          <button type="button" onClick={downloadAudio} disabled={!audioUrl || isGenerating} className="studio-button studio-button-secondary min-h-12" aria-label="تنزيل المقطع الصوتي">
            <Download className="size-4" strokeWidth={1.75} aria-hidden="true" />
            <span>تنزيل<span className="hidden xl:inline"> المقطع</span></span>
          </button>
        </div>
      </div>
    </footer>
  );
};
