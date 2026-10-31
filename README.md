# 🎙️ Talky — استوديو الصوت العربي الفائق الذكاء

> منصة ويب عربية متكاملة لتحويل **النص إلى كلام (Text-to-Speech)** واستنساخ الأصوات (Voice Cloning) مدعومة بأحدث نماذج الذكاء الاصطناعي المفتوحة المصدر (`silma-ai/silma-tts`) ومسرعة بتقنية **ONNX Runtime** السحابية على خوادم Modal.

![Talky Studio Banner](frontend/src/assets/hero.png)

---

## ✨ المميزات الرئيسية

* 🗣️ **نطق عربي طبيعي وفصيح**: مدعوم بنموذج `silma-tts` المتخصص في الصوتيات والتراكيب والتشكيل العربي.
* ⚡ **محرك ONNX فائق السرعة**: استدلال سريع ومباشر على المعالجات (CPU) عبر 16 خيط معالجة و16 خطوة مطابقة تدفق (NFE) بدلاً من بطء محركات PyTorch التقليدية (تسريع يتجاوز 5.4 أضعاف).
* 🎤 **استنساخ الأصوات لحظياً**: إمكانية رفع عينة صوتية مرجعية أو تسجيل صوتك مباشرة عبر الميكروفون ليتم التوليد بنفس نبرة وطبقة الصوت.
* 🎨 **لغة تصميم «حَرَكات»**: واجهة مستخدم عربية فخمة مستوحاة من الخط العربي وألوان الحبر والكحل والعنبر والزعفران (`Amiri` & `IBM Plex Sans Arabic`).
* ☁️ **بنية تحتية سحابية عديمة الخوادم (Serverless)**:
  * **الخادم السحابي**: تطبيق موحد على [Modal](https://modal.com) مع ذاكرة رام لحظية دافئة (`scaledown_window=180`).
  * **الواجهة الأمامية**: تطبيق ويب ثابت (Static SPA) يُنشر تلقائياً عبر GitHub Actions على GitHub Pages.

---

## 🏗️ المعمارية التقنية (Architecture)

```
talky/
├── backend/
│   └── modal/
│       ├── app.py             # التطبيق السحابي الموحد (TalkyServer + ONNX Export + Benchmarks)
│       ├── requirements.txt   # متطلبات الخادم
│       └── talky/
│           ├── api.py         # واجهات FastAPI ومسارات /v1/generate و /v1/health
│           ├── engine.py      # محرك الاستدلال الذكي مع التبديل التلقائي
│           ├── onnx_engine.py # خط أنابيب ONNX المسرّع مع I/O Bindings
│           ├── audio.py       # معالجة وتطبيع الصوتيات
│           ├── schemas.py     # نماذج Pydantic للطلبات والاستجابات
│           └── errors.py      # معالجة الأخطاء بالعربية والإنجليزية
├── frontend/                  # تطبيق React + Vite + Tailwind v4
│   ├── src/
│   │   ├── features/
│   │   │   ├── editor/        # محرر النصوص والتشكيل
│   │   │   ├── player/        # مشغل الصوت الاحترافي
│   │   │   ├── recorder/      # نافذة استنساخ وتسجيل الصوت
│   │   │   └── voices/        # قائمة الأصوات المرجعية والمفضلة
│   │   ├── services/          # عميل API ومحرك الصوت المحلي (IndexedDB)
│   │   └── domain/            # تعريفات الأنواع (TypeScript)
│   └── vite.config.ts
└── .github/
    └── workflows/
        └── deploy-frontend.yml # سير عمل النشر التلقائي على GitHub Pages
```

---

## 🚀 التشغيل والنشر

### 1. تشغيل وتطوير الواجهة محلياً:
```bash
cd frontend
npm install
npm run dev
```

### 2. نشر الخادم السحابي على Modal:
```bash
# تثبيت أداة modal وتسجيل الدخول
pip install modal
modal setup

# نشر الخادم السحابي الموحد
python -m modal deploy backend/modal/app.py
```

### 3. تصدير أوزان ONNX المسرعة (عند الحاجة):
```bash
python -m modal run backend/modal/app.py --action export
```

---

## 📄 الرخصة
مرخص تحت رخصة **Apache 2.0**.
