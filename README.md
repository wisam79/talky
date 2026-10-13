---
title: Talky
emoji: 🎙️
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: 6.12.0
app_file: app.py
pinned: false
license: apache-2.0
tags:
  - text-to-speech
  - tts
  - arabic
  - voice-cloning
  - omnivoice
short_description: Arabic Text To Speech with OmniVoice
---

# 🎙️ Talky Engine — محرك الصوت العربي الذكي

تطبيق ويب تقدمي (PWA) عربي كامل لتحويل **النص إلى كلام**، متخصص باللغة العربية
مع **استنساخ الصوت** ووضع **البودكاست متعدد الشخصيات** — مشغّل بنموذج
[`k2-fsa/OmniVoice`](https://huggingface.co/k2-fsa/OmniVoice).

## ✨ الميزات

- 🎵 **توليد صوت عربي** مع شخصيات جاهزة (راوي، مذيع، معلم، قصص أطفال...)
- 🎤 **استنساخ الصوت**: رفع ملف مرجعي أو تسجيل حي من المايك
- 🎭 **استوديو بودكاست**: حوار `اسم: نص` → مقطع لكل شخصية + دمج الكل WAV
- ⚡ **ضوابط حقيقية**: السرعة / الجودة Steps / الالتزام — تُرسل للنموذج مباشرة
- ⏹ **إلغاء + تقدم SSE حقيقي** بمراحل (رفع → انتظار → توليد → تحميل)
- 📄 **استيراد نص** من TXT/MD/SRT/VTT + تقسيم ذكي للنصوص الطويلة ودمجها
- ⭐ **مفضلة صوتية** + 🌙☀️ **ثيم فاتح/داكن** + 📤 **مشاركة Web Share**
- 📚 **سجل IndexedDB** محلي (15 عنصراً، إخلاء تلقائي عند امتلاء الحصة) + بحث
- 📱 **PWA قابل للتثبيت** مع Service Worker وأيقونات PNG حقيقية

## 🚀 التشغيل المحلي

```bash
pip install -r requirements.txt
uvicorn apps.backend.app:app --reload --port 7860
# → http://localhost:7860
```

متغيرات البيئة (اختيارية):

| المتغير | الافتراضي | الوصف |
|---|---|---|
| `PORT` | `7860` | منفذ التشغيل |
| `HF_TOKEN` | — | توكن HuggingFace (للحصص الأعلى) |
| `API_KEY` | — | إن ضُبط، يجب إرسال `X-API-Key` مع `/api/generate` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | `20` / `3600` | حد الطلبات لكل IP |
| `PREDICT_TIMEOUT` | `240` | مهلة التوليد بالثواني |

## 🔌 API

### `POST /api/generate` (multipart/form-data)

| الحقل | النوع | الوصف |
|---|---|---|
| `text` | str **(مطلوب)** | النص (حتى 5000 حرف) |
| `language/dialect/gender/role/accent` | str | مواصفات الصوت (`Auto` للتلقائي) |
| `ref_text` | str | النص المنطوق في العينة المرجعية |
| `speed` | float `0.5–2.0` | سرعة النموذج |
| `steps` | int `8–64` | جودة التوليد |
| `guidance` | float `0.5–5.0` | الالتزام بالأسلوب |
| `ref_audio` | file | عينة صوتية (wav/mp3/ogg/m4a/webm/flac حتى 10MB) |

الرد: `audio/wav`. الأخطاء: `400` نص فارغ/طويل، `413` ملف ضخم،
`415` نوع غير مدعوم، `429` تجاوز الحد (مع `Retry-After`)،
`504` انتهت مهلة التوليد.

### `GET /health` → `{"status": "ok"}`

## 🏗️ البنية

```
apps/
  backend/app.py     باكند FastAPI (proxy + static + rate-limit) — يعمل على Render
  frontend/app_hf.py خادم خفيف للواجهة فقط — يعمل على HuggingFace Space
scripts/
  deploy_frontend.py نشر الواجهة إلى Space مع حقن RENDER_URL
  deploy_full.py     نشر المشروع كاملاً إلى Space
  run_tests.py       مشغّل اختبارات pytest
tools/               سكربتات استكشافية لمرة واحدة (توقيع API وغيرها)
static/              الواجهة (index.html + css + js + icons + manifest + sw)
tests/               اختبارات pytest (وحدة + تكامل)
```

> ملاحظة معمارية: الواجهة تنادي OmniVoice مباشرة من المتصفح للسرعة،
> والباكند موجود كـ proxy بديل + لخدمة الملفات محلياً.

## 🧪 الاختبارات

```bash
python scripts/run_tests.py --quick        # وحدة فقط
python scripts/run_tests.py                # وحدة
python scripts/run_tests.py --integration  # يشمل نداءات OmniVoice الحقيقية
```

## 🌐 النشر

```bash
# .env يحتاج: HF_TOKEN + RENDER_URL
python scripts/deploy_frontend.py    # نشر الواجهة فقط إلى Space
python scripts/deploy_full.py        # نشر المشروع كاملاً
```

### تشغيل مجاني موصى به

الواجهة تعمل كـ Static PWA ويمكن نشرها مجاناً على GitHub Pages عبر
`.github/workflows/deploy.yml`. بعد تفعيل **Settings → Pages → GitHub Actions**
في المستودع، كل push إلى `main` ينشر مجلد `static/` تلقائياً. التوليد يتم
مباشرة من المتصفح عبر OmniVoice، لذلك لا تحتاج الواجهة إلى خادم Python دائم.

> ⚠️ سكربت النشر يستخدم `git push --force` — راجع فرع Space قبل التشغيل.

## 📄 الرخصة

Apache-2.0 — Check out the configuration reference at https://huggingface.co/docs/hub/spaces-config-reference
