import React from 'react';
import { AlignRight, CircleHelp, Clock3, SlidersHorizontal, Sparkles } from 'lucide-react';

interface ManuscriptEditorProps {
  text: string;
  onChange: (val: string) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  pitch?: number;
  onPitchChange?: (pitch: number) => void;
  format: 'wav' | 'mp3';
  onFormatChange: (format: 'wav' | 'mp3') => void;
  disabled?: boolean;
}

const TASHKEEL_MARKS = [
  { char: '\u064E', name: 'فتحة' },
  { char: '\u064F', name: 'ضمة' },
  { char: '\u0650', name: 'كسرة' },
  { char: '\u0652', name: 'سكون' },
  { char: '\u0651', name: 'شدة' },
  { char: '\u064B', name: 'تنوين فتح' },
  { char: '\u064C', name: 'تنوين ضم' },
  { char: '\u064D', name: 'تنوين كسر' },
];

export const ManuscriptEditor: React.FC<ManuscriptEditorProps> = ({
  text,
  onChange,
  speed,
  onSpeedChange,
  pitch = 0,
  onPitchChange,
  format,
  onFormatChange,
  disabled,
}) => {
  const maxLength = 1500;
  const currentLength = text.length;
  const isNearLimit = currentLength >= maxLength * 0.9;
  const isOverLimit = currentLength > maxLength;

  // حساب تقديري للمدة (نحو 13 حرف في الثانية بالعربية)
  const estimatedSeconds = Math.max(1, Math.round(currentLength / (13 * speed)));

  const addMark = (mark: string) => {
    onChange(text + mark);
  };

  return (
    <section className="studio-panel manuscript-editor" aria-labelledby="editor-heading">
      <div className="flex items-center justify-between gap-3 border-b border-ink-600 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="section-step" aria-hidden="true">02</span>
          <div>
            <h2 id="editor-heading" className="text-base font-semibold text-paper-100">اكتب نصّك</h2>
            <p id="manuscript-hint" className="mt-0.5 text-xs leading-relaxed text-mist-300">نطق فصيح ونبرات واقعية دقيقة</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-mist-300">
          <AlignRight className="size-4" strokeWidth={1.75} aria-hidden="true" />
          العربية الفصحى
        </span>
      </div>

      {/* جسم المحرر بخط النسخ ومسطرة خافتة */}
      <div className="manuscript-body">
        <label htmlFor="manuscript-text" className="sr-only">النص المراد تحويله إلى صوت</label>
        <textarea
          id="manuscript-text"
          dir="auto"
          lang="ar"
          rows={4}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={`manuscript-hint manuscript-count${isOverLimit ? ' manuscript-limit' : ''}`}
          aria-invalid={isOverLimit}
          placeholder="اكتب شيئًا يستحق أن يُسمع… قصة، فكرة، حوار، أو مقال."
          className="manuscript-ruler"
        />

        {isOverLimit && (
          <p id="manuscript-limit" role="alert" className="mt-3 rounded-control border border-unnab-400/30 bg-unnab-400/10 px-3 py-2 text-sm leading-relaxed text-unnab-400">
            الحد الأقصى 1500 حرف لكل مقطع. اختصر النص قبل توليد الصوت.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-mist-300">
            <Clock3 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            <span>المدة التقديرية <span className="tabular-numbers">{currentLength > 0 ? estimatedSeconds : 0}</span> ث</span>
          </span>
          <div className="flex items-center gap-2.5">
            <span id="manuscript-count" className={`tabular-numbers ${isOverLimit ? 'text-unnab-400' : isNearLimit ? 'text-brass-400' : 'text-mist-300'}`}>
              <bdi>{currentLength} / {maxLength}</bdi> حرف
            </span>
            <span className="h-1 w-12 overflow-hidden rounded-full bg-ink-600" aria-hidden="true">
              <span
                className={`block h-full rounded-full ${isOverLimit ? 'bg-unnab-400' : isNearLimit ? 'bg-brass-400' : 'bg-mist-500'}`}
                style={{ width: `${Math.min(100, (currentLength / maxLength) * 100)}%` }}
              />
            </span>
          </div>
        </div>
      </div>

      {/* شريط علامات التشكيل */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink-600 px-4 py-3 sm:px-6">
        <span className="text-xs text-mist-300">أضف تشكيلًا</span>
        <div className="flex flex-wrap gap-1" role="group" aria-label="علامات التشكيل">
          {TASHKEEL_MARKS.map((mark) => (
            <button
              key={mark.name}
              type="button"
              onClick={() => addMark(mark.char)}
              disabled={disabled}
              className="flex size-11 items-center justify-center rounded-control border border-ink-600 bg-ink-900 font-amiri text-2xl leading-none text-paper-100 transition-colors hover:border-ink-500 hover:bg-ink-700"
              title={mark.name}
              aria-label={`إضافة ${mark.name}`}
            >
              <span aria-hidden="true">{`ـ${mark.char}`}</span>
            </button>
          ))}
        </div>
        <span className="ms-auto hidden text-xs text-mist-500 xl:inline">اختياري</span>
      </div>

      {/* خيارات التحكم بالسرعة والنبرة والصيغة */}
      <div className="editor-controls grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* سرعة الإلقاء */}
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="voice-speed" className="flex items-center gap-2 text-xs font-medium text-mist-300">
              <SlidersHorizontal className="size-4" strokeWidth={1.75} aria-hidden="true" />
              سرعة الإلقاء
            </label>
            <output htmlFor="voice-speed" className="text-xs tabular-numbers text-paper-100" dir="ltr">{speed.toFixed(2)}×</output>
          </div>
          <input
            id="voice-speed"
            type="range"
            dir="ltr"
            min="0.7"
            max="1.3"
            step="0.05"
            value={speed}
            disabled={disabled}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            aria-valuetext={`${speed.toFixed(2)} ضعف السرعة الطبيعية`}
            className="speed-slider"
          />
          <div className="flex justify-between text-xs text-mist-500" dir="ltr">
            <span>0.7×</span>
            <span>1.3×</span>
          </div>
        </div>

        {/* نبرة الصوت (Pitch) */}
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="voice-pitch" className="flex items-center gap-2 text-xs font-medium text-mist-300">
              <Sparkles className="size-4" strokeWidth={1.75} aria-hidden="true" />
              طبقة النبرة
            </label>
            <output htmlFor="voice-pitch" className="text-xs tabular-numbers text-paper-100" dir="ltr">
              {pitch > 0 ? `+${pitch}Hz` : pitch < 0 ? `${pitch}Hz` : 'طبيعية'}
            </output>
          </div>
          <input
            id="voice-pitch"
            type="range"
            dir="ltr"
            min="-15"
            max="15"
            step="1"
            value={pitch}
            disabled={disabled}
            onChange={(e) => onPitchChange && onPitchChange(parseInt(e.target.value, 10))}
            aria-valuetext={`نبرة الصوت ${pitch} هرتز`}
            className="speed-slider"
          />
          <div className="flex justify-between text-xs text-mist-500" dir="ltr">
            <span>أعمق</span>
            <span>أعلى</span>
          </div>
        </div>

        {/* صيغة الصوت */}
        <div>
          <p id="audio-format-label" className="mb-2 text-xs font-medium text-mist-300">صيغة الصوت</p>
          <div className="flex gap-1 rounded-control border border-ink-600 bg-ink-900 p-1" role="group" aria-labelledby="audio-format-label" dir="ltr">
            {(['wav', 'mp3'] as const).map((audioFormat) => (
              <button
                key={audioFormat}
                type="button"
                onClick={() => onFormatChange(audioFormat)}
                disabled={disabled}
                aria-pressed={format === audioFormat}
                className={`min-h-11 flex-1 rounded-[6px] px-3 text-xs font-semibold transition-colors ${format === audioFormat ? 'bg-ink-600 text-paper-100' : 'text-mist-300 hover:bg-ink-700'}`}
              >
                {audioFormat === 'wav' ? 'WAV' : 'MP3'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="studio-note border-t border-ink-600 px-4 py-3 sm:px-6">
        <CircleHelp className="mt-1 size-3.5 shrink-0 text-mist-500" strokeWidth={1.75} aria-hidden="true" />
        <p>ملاحظة: يدعم المحرك علامات الترقيم (؟ ، .) لإعطاء تنغيم بشري طبيعي للسياق.</p>
      </div>
    </section>
  );
};
