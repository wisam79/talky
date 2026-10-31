import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, Download, RotateCcw, Volume2, Sparkles } from 'lucide-react';

interface StudioPlayerProps {
  audioUrl: string | null;
  durationMs?: number;
  timings?: { inferMs: number; totalMs: number };
  voiceName?: string;
}

export const StudioPlayer: React.FC<StudioPlayerProps> = ({
  audioUrl,
  durationMs: _durationMs,
  timings,
  voiceName,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1.0);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
    }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#6366f1',
      progressColor: '#a855f7',
      cursorColor: '#c084fc',
      barWidth: 3,
      barGap: 3,
      barRadius: 3,
      height: 70,
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
  }, [audioUrl]);

  if (!audioUrl) return null;

  const togglePlay = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
      setIsPlaying(wavesurferRef.current.isPlaying());
    }
  };

  const restart = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.seekTo(0);
      wavesurferRef.current.play();
      setIsPlaying(true);
    }
  };

  const changeSpeed = (newSpeed: number) => {
    setSpeed(newSpeed);
    if (wavesurferRef.current) {
      wavesurferRef.current.setPlaybackRate(newSpeed);
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  const downloadAudio = () => {
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `talky_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-purple-500/30 rounded-2xl p-5 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* رأس المشغل ومعلومات الأداء */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center">
            <Volume2 className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <span>المقطع الصوتي المولد</span>
              {voiceName && (
                <span className="text-xs font-normal text-purple-300 bg-purple-950/60 px-2 py-0.5 rounded-full border border-purple-800/50">
                  بصوت: {voiceName}
                </span>
              )}
            </h4>
          </div>
        </div>

        {timings && (
          <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
            <span className="flex items-center gap-1 text-emerald-400">
              <Sparkles className="w-3 h-3" />
              <span>زمن الاستدلال: {timings.inferMs}ms</span>
            </span>
            <span className="text-slate-600">•</span>
            <span>المدة الإجمالية: {(timings.totalMs / 1000).toFixed(2)}s</span>
          </div>
        )}
      </div>

      {/* عارض الموجات الصوتية */}
      <div className="py-2 px-1 bg-slate-950/60 rounded-xl border border-slate-900 mb-4">
        <div ref={containerRef} className="cursor-pointer" />
      </div>

      {/* شريط التحكم والأزرار */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-3">
          {/* زر التشغيل / الإيقاف المؤقت */}
          <button
            onClick={togglePlay}
            className="w-12 h-12 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-purple-600/30 transition-all hover:scale-105 active:scale-95"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current mr-0.5" />
            )}
          </button>

          {/* زر إعادة التشغيل */}
          <button
            onClick={restart}
            className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors"
            title="إعادة التشغيل من البداية"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* التوقيت */}
          <div className="text-xs font-mono text-slate-400">
            <span>{formatTime(currentTime)}</span> / <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* سرعة التشغيل والتنزيل */}
        <div className="flex items-center gap-2">
          {/* محدد السرعة */}
          <div className="flex items-center bg-slate-800/80 rounded-xl p-1 text-xs font-mono">
            {[0.8, 1.0, 1.25, 1.5].map((s) => (
              <button
                key={s}
                onClick={() => changeSpeed(s)}
                className={`px-2 py-1 rounded-lg transition-colors ${
                  speed === s
                    ? 'bg-purple-600 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* زر التحميل */}
          <button
            onClick={downloadAudio}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-purple-950/60 hover:bg-purple-900/80 border border-purple-700/50 text-purple-200 text-xs font-semibold rounded-xl shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Download className="w-4 h-4" />
            <span>تحميل WAV</span>
          </button>
        </div>
      </div>
    </div>
  );
};
