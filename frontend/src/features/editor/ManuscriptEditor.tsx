import React from 'react';
import { Clock, Sliders } from 'lucide-react';

interface ManuscriptEditorProps {
  text: string;
  onChange: (val: string) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
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
  format,
  onFormatChange,
  disabled,
}) => {
  const maxLength = 600;
  const currentLength = text.length;
  const isNearLimit = currentLength >= maxLength * 0.9;
  const isOverLimit = currentLength > maxLength;

  // حساب تقديري للمدة (نحو 13 حرف في الثانية بالعربية)
  const estimatedSeconds = Math.max(1, Math.round(currentLength / (13 * speed)));

  const addMark = (mark: string) => {
    onChange(text + mark);
  };

  return (
    <div className="w-full max-w-[760px] mx-auto bg-[#10172D] border border-[#222C54] rounded-[4px] shadow-2xl flex flex-col justify-between overflow-hidden">
      {/* جسم المحرر (المخطوطة) */}
      <div className="p-8 sm:p-10 relative">
        <textarea
          dir="auto"
          lang="ar"
          rows={7}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="اكتب النص الذي تريد سماعه. التشكيل اختياري، وإذا كتبته فسيُنطق كما كتبته."
          className="w-full bg-transparent text-[#EEEAE0] placeholder-[#7C85A8] resize-none outline-none font-amiri text-[24px] sm:text-[26px] manuscript-ruler border-none leading-[2.1]"
        />

        {/* تنبيه تجزئة النص إذا تجاوز الحد */}
        {isOverLimit && (
          <div className="mt-2 text-xs text-[#E0A93B] bg-[#E0A93B]/10 border border-[#E0A93B]/30 px-3 py-1.5 rounded-[4px]">
            تجاوز النص الحد الموصى به (600 حرف)؛ سيتم تقسيم النص إلى مقاطع ومعالجتها تلقائياً.
          </div>
        )}
      </div>

      {/* الشريط السفلي للصفحة (أدوات المسطرة والإعدادات) */}
      <div className="bg-[#0A0F1F]/60 border-t border-[#222C54] px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* التشكيل السريع */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[#7C85A8] text-[11px] ml-1">حَرَكات:</span>
          {TASHKEEL_MARKS.map((m) => (
            <button
              key={m.name}
              type="button"
              onClick={() => addMark(m.char)}
              disabled={disabled}
              className="px-2 py-0.5 bg-[#172040] hover:bg-[#222C54] hover:text-[#E0A93B] text-[#EEEAE0] rounded-[4px] border border-[#222C54] transition-all font-mono text-sm"
              title={m.name}
            >
              {m.char}
            </button>
          ))}
        </div>

        {/* عناصر التحكم (السرعة، الصيغة، العداد) */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* محدد السرعة */}
          <div className="flex items-center gap-2">
            <Sliders className="w-3.5 h-3.5 text-[#7C85A8]" />
            <span className="text-[#A9B0CB] text-[11px]">السرعة:</span>
            <input
              type="range"
              min="0.7"
              max="1.3"
              step="0.05"
              value={speed}
              disabled={disabled}
              onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
              className="w-16 accent-[#E0A93B] cursor-pointer"
            />
            <span className="font-mono text-[#EEEAE0] text-[11px] tabular-numbers w-8">
              {speed.toFixed(2)}x
            </span>
          </div>

          {/* تبديل الصيغة WAV / MP3 */}
          <div className="flex items-center bg-[#172040] rounded-[6px] p-0.5 border border-[#222C54]">
            <button
              type="button"
              onClick={() => onFormatChange('wav')}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded-[4px] transition-colors ${
                format === 'wav'
                  ? 'bg-[#E0A93B] text-[#0A0F1F]'
                  : 'text-[#A9B0CB] hover:text-[#EEEAE0]'
              }`}
            >
              WAV
            </button>
            <button
              type="button"
              onClick={() => onFormatChange('mp3')}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded-[4px] transition-colors ${
                format === 'mp3'
                  ? 'bg-[#E0A93B] text-[#0A0F1F]'
                  : 'text-[#A9B0CB] hover:text-[#EEEAE0]'
              }`}
            >
              MP3
            </button>
          </div>

          {/* عداد الحروف والزمن التقديري */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-[11px] text-[#A9B0CB]">
              <Clock className="w-3 h-3 text-[#7C85A8]" />
              <span className="tabular-numbers">~{currentLength > 0 ? estimatedSeconds : 0}ث</span>
            </div>

            <span className="text-[#222C54]">|</span>

            <div
              className={`font-mono text-[11px] font-medium tabular-numbers ${
                isOverLimit
                  ? 'text-[#F0737F]'
                  : isNearLimit
                  ? 'text-[#E0A93B]'
                  : 'text-[#7C85A8]'
              }`}
            >
              {currentLength} / {maxLength}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
