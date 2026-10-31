import React from 'react';
import { Sparkles, Trash2, Clock, Type } from 'lucide-react';

interface SmartEditorProps {
  text: string;
  onChange: (val: string) => void;
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

export const SmartEditor: React.FC<SmartEditorProps> = ({ text, onChange, disabled }) => {
  const maxLength = 600;
  const currentLength = text.length;

  // حساب تقديري للمدة (حوالي 12 إلى 15 حرف في الثانية باللغة العربية)
  const estimatedSeconds = Math.max(1, Math.round(currentLength / 13));

  const addMark = (mark: string) => {
    onChange(text + mark);
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-sm transition-all focus-within:border-purple-500/50">
      {/* الشريط العلوي للمحرر */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2 text-purple-400 font-semibold text-sm">
          <Type className="w-4 h-4" />
          <span>النص المراد تحويله إلى صوت</span>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-1.5 bg-slate-800/60 px-2.5 py-1 rounded-full">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>المدة التقديرية: ~{currentLength > 0 ? estimatedSeconds : 0} ثوانٍ</span>
          </div>

          <div
            className={`font-mono font-medium ${
              currentLength > maxLength ? 'text-red-400' : 'text-slate-400'
            }`}
          >
            {currentLength} / {maxLength}
          </div>

          {currentLength > 0 && !disabled && (
            <button
              onClick={() => onChange('')}
              className="text-slate-400 hover:text-red-400 transition-colors p-1"
              title="مسح النص"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* حقل إدخال النص */}
      <textarea
        dir="rtl"
        rows={5}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="اكتب أو الصق النص العربي هنا... (يدعم النموذج التشكيل الآلي، ولكن إضافة الحركات يدوياً تزيد من دقة النطق والفصاحة)"
        className="w-full bg-transparent text-slate-100 placeholder-slate-500 resize-none outline-none leading-relaxed text-lg font-arabic"
      />

      {/* شريط أدوات التشكيل السريع */}
      <div className="mt-3 pt-3 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-slate-500 text-[11px] ml-1">حركات سريعة:</span>
          {TASHKEEL_MARKS.map((m) => (
            <button
              key={m.name}
              type="button"
              onClick={() => addMark(m.char)}
              disabled={disabled}
              className="px-2 py-0.5 bg-slate-800/70 hover:bg-purple-900/40 hover:text-purple-300 text-slate-300 rounded border border-slate-700/50 transition-all font-mono text-sm"
              title={m.name}
            >
              {m.char}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          <Sparkles className="w-3 h-3 text-purple-400" />
          <span>تشكيل آلي مدمج مدعوم بنموذج سلمى</span>
        </div>
      </div>
    </div>
  );
};
