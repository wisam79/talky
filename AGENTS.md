# AGENTS.md — Talky Engine

> ملف الوكيل الشامل: يشرح المشروع، الأخطاء المكتشفة والمُصلحة، النشر، الاختبار، والمستقبل.
> آخر تحديث: 2026-10-13

---

## 1. نظرة عامة

**Talky** = تطبيق ويب تقدّمي (PWA) لتوليد الكلام العربي عبر نموذج **OmniVoice** (`k2-fsa/OmniVoice` على Hugging Face).

- **الفرونتند**: HTML/CSS/JS خالص (بدون build step) — `static/`
- **الباكند** (اختياري): FastAPI proxy — `apps/backend/app.py`
- **النشر**: GitHub Pages (الرئيسي) + HF Space (احتياطي)
- **الاختبار**: pytest (باكند) + node:test + jsdom (فرونتند)

---

## 2. بنية المشروع

```
talky/
├── static/                    # الفرونتند (PWA كامل)
│   ├── index.html             # الصفحة الرئيسية (3 تبويبات: مولّد/بودكاست/سجل)
│   ├── manifest.json          # بيانات PWA
│   ├── sw.js                  # Service Worker (تخزين مؤقت)
│   ├── css/
│   │   ├── style.css          # الثيم الأساسي (dark/light)
│   │   └── apple-hig.css      # ثيم Apple HIG (يُحمَّل بعد style.css)
│   ├── js/
│   │   ├── app.js             # منطق الواجهة (IIFE)
│   │   ├── gradio_api.js      # عميل OmniVoice المباشر ⚠️
│   │   └── config.js          # ⚠️ ميت — غير محمَّل من index.html
│   └── icons/                 # أيقونات PWA (192/512)
├── apps/
│   ├── backend/app.py         # FastAPI proxy (غير مستخدم من الفرونتند حالياً)
│   └── frontend/app_hf.py     # نسخة FastAPI للنشر على HF Space
├── tests/                     # اختبارات Python
│   ├── conftest.py            # fixtures مشتركة (mock OmniVoice)
│   ├── test_api.py            # اختبارات API أساسية
│   ├── test_backend.py        # اختبارات شاملة (mocked)
│   ├── test_static_frontend.py# اتساق ساكن (ids/assets/عقود)
│   ├── test_live_contract.py  # اختبارات حية (TALKY_LIVE_TESTS=1)
│   └── test_integration.py    # تكامل gradio_client (شبكة)
├── tests_js/                  # اختبارات JavaScript
│   ├── gradio_api.test.js     # عقود gradio_api.js (vm sandbox)
│   ├── app_dom.test.js        # اختبارات DOM (jsdom)
│   └── helpers/               # EventSource وهمي + IndexedDB وهمي + dom_env
├── scripts/
│   ├── run_tests.py           # runner موحّد (pytest + node)
│   ├── deploy_frontend.py     # نشر static/ إلى HF Space
│   └── deploy_full.py         # نشر كامل (يشمل node_modules — قديم)
├── tools/                     # أدوات تحليل API (تطوير)
├── docs/                      # فارغ
├── .github/workflows/
│   ├── deploy.yml             # نشر static/ إلى GitHub Pages
│   └── test.yml               # CI للاختبارات
├── package.json               # jsdom + scripts test
├── requirements.txt           # fastapi, gradio_client, pytest, httpx...
└── render.yaml                # نشر الباكند على Render
```

---

## 3. الأخطاء الحرجة المكتشفة والمُصلحة (2026-10-10)

### ✅ أُصلحت

| # | الخطأ | الملف | الإصلاح |
|---|---|---|---|
| 1 | **مسار API خاطئ**: `/call/_clone_fn` → 404 | `static/js/gradio_api.js` | `/gradio_api/call/_clone_fn` + `/gradio_api/upload` |
| 2 | **صيغة SSE خاطئة**: الكود ينتظر `msg: process_completed` لكن OmniVoice يرسل `event: complete` مع `data: [audio, status]` | `static/js/gradio_api.js` | `addEventListener("complete")` + `addEventListener("error")` + `process_generating` |
| 3 | **لغة "Arabic" غير مقبولة** في OmniVoice (الصحيح "Standard Arabic") | `static/index.html` + `apps/backend/app.py` | `Standard Arabic` + `_normalize_language()` |

### ⚠️ لم تُصلح بعد (معروفة)

| # | الخطأ | التأثير | الأولوية |
|---|---|---|---|
| 4 | `_clone_fn` **يتطلب عينة مرجعية** — الواجهة تعتبرها اختيارية | توليد بدون مرجعي يفشل بـ "Please upload a reference audio." | عالية |
| 5 | **المفضّلات لا تستعيد** اللهجة/اللكنة (`accent-adv`/`dialect-adv` غير موجودة في HTML) | حفظ يعمل، استرجاع يفقد 3 حقول | متوسطة |
| 6 | `config.js` **ميت** + `RENDER_BACKEND_URL_PLACEHOLDER` غير موجود | deploy_frontend.py يطبع نجاح وهمي | متوسطة |
| 7 | الباكند **بلا مستهلك** (الفرونتند يستدعي OmniVoice مباشرة) | rate-limit/CORS/API-key بلا فائدة | متوسطة |
| 8 | **ZeroGPU quota** — الفرونتند يرسل بدون توكن | حصة مجهولة ضئيلة | عالية |
| 9 | `mergeAudioBlobs` يبني buffer بمعدل المقطع الأول فقط | تشويه لو اختلفت معدلات المقاطع | منخفضة |
| 10 | 1763 ملف `node_modules` + `__pycache__` **متتبَّعة في git** | repo bloated | منخفضة |

---

## 4. OmniVoice API — العقد الحقيقي

**الأساس**: `https://k2-fsa-omnivoice.hf.space`

### المسارات الصحيحة
```
POST /gradio_api/upload              → ["path/to/file"]
POST /gradio_api/call/_clone_fn      → {event_id}
GET  /gradio_api/call/_clone_fn/<id> → SSE stream
GET  /gradio_api/file=<path>         → ملف الصوت
GET  /gradio_api/info                → توقيع الدوال
```

### توقيع `_clone_fn` (12 معامل)
```js
{
  data: [
    text,        // string — النص (≤5000 حرف)
    language,    // string — Auto | Standard Arabic | Egyptian Arabic | Gulf Arabic | ...
    refAudio,    // FileData | null — ⚠️ مطلوب فعلياً
    refText,     // string — نص العينة المرجعية
    instruct,    // string — "Male, News Anchor, British Accent"
    ns,          // number — خطوات (8–64)
    gs,          // number — Guidance (0.5–5.0)
    dn,          // boolean
    sp,          // number — سرعة (0.5–2.0)
    du,          // number | null — المدة (null = تلقائي)
    pp,          // boolean
    po           // boolean
  ]
}
```

### صيغة SSE الحقيقية
```
event: complete
data: [{"url": "...", "path": "...", "orig_name": "...", "meta": {...}}, "ok"]

event: error
data: null | {"msg": "..."}

event: process_generating
data: {"progress_data": [{"index": 2, "length": 8}]}
```

### قيود مهمة
- **ZeroGPU**: حصة محدودة لكل مستخدم/فترة — المستخدمون المجهولون يستنفدونها سريعاً
- **`lang`**: قائمة محددة — "Arabic" ❌، "Standard Arabic" ✅
- **`ref_audio`**: مطلوب (رسالة "Please upload a reference audio." بدونه)

---

## 5. النشر

### GitHub Pages (الرئيسي)
```bash
git push origin main   # .github/workflows/deploy.yml ينشر static/ تلقائياً
```
- الرابط: `https://wisam99.github.io/talky/` (أو النطاق المخصص)
- ✅ CORS من OmniVoice مسموح لهذا النطاق (تم التحقق)

### HF Space (احتياطي)
```bash
# الطريقة الاحترافية (بدون git-push):
export HF_TOKEN=$(grep HF_TOKEN .env | cut -d= -f2)
python -c "
from huggingface_hub import HfApi
api = HfApi(token='$HF_TOKEN')
api.upload_folder(repo_id='wisam99/talky', repo_type='space', folder_path='static')
"
```
- **المساحات**:
  - `wisam99/talky` — ⚠️ PAUSED ("Flagged as abusive") — يحتاج Resume يدوي من UI
  - `wisam99/talky-pwa` — ✅ RUNNING (انتظر 10–25 دقيقة لأول انتشار CDN)
- **SDK**: `static` (README.md frontmatter: `sdk: static`)
- ⚠️ `hf spaces restart` لا يعمل مع static spaces

### Render (الباكند — اختياري)
```bash
# render.yaml موجود — الباكند غير مستخدم من الفرونتند حالياً
```

---

## 6. الاختبار

### المتطلبات
- Python 3.11+ مع `pip install -r requirements.txt` (pytest, fastapi, httpx, gradio_client)
- Node 18+ مع `npm install` (jsdom)

### التشغيل
```bash
# كل الاختبارات (سريع):
python scripts/run_tests.py

# تفصيلي:
python scripts/run_tests.py --all

# اختبارات حية (شبكة، خالية من الحصة):
TALKY_LIVE_TESTS=1 python -m pytest tests/test_live_contract.py

# اختبارات JS فقط:
node --test tests_js/*.test.js
```

### ما تغطيه
- **test_backend.py**: تحقق، نطاقات، تعليمات، ملفات مرجعية، أخطاء OmniVoice، مفتاح API، حد معدل، CORS
- **test_static_frontend.py**: اتساق ids، أصول، manifest، sw، عقود API، أسرار
- **gradio_api.test.js**: رفع، إرسال 12 معامل، SSE حقيقي، إلغاء، تقدم
- **app_dom.test.js**: ثيم، تبويبات، عداد كلمات، إعدادات مسبقة، مفضّلات، استيراد مستند، توليد، سجل (15 عنصر، حصة)، بودكاست

---

## 7. المكتبات الموصى بها (مبحوثة 2026-10-10)

### الأولوية القصوى (تحل أخطاء حرجة)
| المكتبة | الرخصة | الغرض |
|---|---|---|
| **`@gradio/client`** | ISC | عميل Gradio الرسمي للـ JS — يحل مسارات API + SSE + رفع ملفات + إلغاء + حالة Space + token |
| **`huggingface_hub`** | Apache-2.0 | `HfApi.upload_folder()` للنشر + `hf spaces` للإدارة |
| **`eventsource-parser`** | MIT | محلل SSE قوي (7.4M/أسبوع) |

### الواجهة والصوت
| المكتبة | الرخصة | الغرض |
|---|---|---|
| **`wavesurfer.js`** v7 | BSD-3 | موجة صوت تفاعلية + مشغّل + Timeline + Record plugin |
| **`vite-plugin-pwa`** | MIT | SW تلقائي + manifest + تحديث تلقائي (يتطلب Vite) |
| **`lucide-static`** | ISC | أيقونات Lucide رسمية (الأيقونات الحالية مرسومة يدوياً بنفس النمط) |
| **`RecordRTC`** | MIT | تسجيل مايك متقدم |

### الباكند
| المكتبة | الرخصة | الغرض |
|---|---|---|
| **`slowapi`** | MIT | حد معدل احترافي + Retry-After تلقائي |
| **`pydantic-settings`** | Apache-2.0 | إعدادات موحدة مُتحقق منها |
| **`tenacity`** | Apache-2.0 | إعادة محاولة + backoff |
| **`soundfile`** | BSD | تحقق فعلي من العينة المرجعية |

### الاختبارات
| المكتبة | الرخصة | الغرض |
|---|---|---|
| **`@fake-indexeddb/fake-indexeddb`** | Apache-2.0 | يستبدل الـ fake اليدوي (82.8% من اختبارات WPT) |
| **`Vitest`** + happy-dom | MIT | ترقية عن node:test (watch, coverage, mocking) |
| **`msw`** | MIT | اعتراض fetch على مستوى الشبكة |
| **`Playwright`** | Apache-2.0 | E2E حقيقي (مايك، SW، صوت فعلي) |

---

## 8. خطة العمل المستقبلية

### المرحلة 1: إصلاح فوري (ساعة)
- [x] مسارات API صحيحة
- [x] تحليل SSE حقيقي
- [x] لغة Standard Arabic
- [ ] فرض/توضيح العينة المرجعية (أو التحويل لـ `_design_fn` بدونها)
- [ ] إصلاح المفضّلات (`accent`/`dialect` بدل `*-adv`)

### المرحلة 2: جودة (يوم)
- [ ] تبنّي `@gradio/client` (يحذف gradio_api.js بالكامل)
- [ ] `wavesurfer.js` للموجة والمشغّل
- [ ] `slowapi` + `pydantic-settings` + `tenacity` للباكند
- [ ] حذف `config.js` الميت أو ربطه

### المرحلة 3: بنية (أسبوع)
- [ ] Vite + `vite-plugin-pwa` + `lucide-static`
- [ ] Vitest + fake-indexeddb + Playwright
- [ ] حل ZeroGPU quota: proxy باكند مع HF_TOKEN (أو توكن مستخدم)
- [ ] تنظيف git: `git rm -r --cached node_modules __pycache__`

---

## 9. ملاحظات تشغيلية

- **`.env`**: غير متتبَّع في git ✅ (التوكن آمن)
- **`hf auth whoami`**: `wisam99` ✅
- **CORS**: OmniVoice يسمح صريحاً لـ `https://wisam99.github.io` و `https://wisam99-talky.hf.space` ✅
- **الـ Space**: `wisam99/talky` كان PAUSED وأُعيد تشغيله عبر `upload_folder` في 2026-10-13 (RUNNING, sdk: static, app_file: index.html).
- **الحد الزمني**: 180s (JS) مقابل 240s (باكند) — غير متناسق
- **الحد الأقصى للنص**: 5000 حرف (باكند) مقابل تقسيم 1200 حرف (فرونتند)

---

## 10. روابط سريعة

- **الفرونتند (GitHub Pages)**: `https://wisam99.github.io/talky/`
- **HF Space**: `https://wisam99-talky.hf.space` (RUNNING، static)
- **OmniVoice**: `https://k2-fsa-omnivoice.hf.space`
- **API info**: `https://k2-fsa-omnivoice.hf.space/gradio_api/info`

---

*آخر تحديث: 2026-10-13*
## 11. تحديث 2026-10-13 — backend proxy + UI polish

**مُنجز:**
- `config.js` تحوّل إلى `TALKY_CONFIG` قوي: يفهم `?api=` للاختبار، يميز placeholder، ويعرّف `directMode`.
- `app.js`: مسار توليد مزدوج — `generateVoiceViaBackend()` عند `apiBase` + `generateVoiceGradio()` كاحتياطي؛ نفس الشيء للبودكاست؛ شارة حالة الباكند؛ hint للمرجع؛ حراس null لجميع الـ listeners.
- الباكند جاهز كـ proxy (HF_TOKEN + rate-limit 20/3600 + Retry-After) — يحتاج فقط `RENDER_URL` أو `?api=` لتفعيله.
- `vendor.js` أُعيد بناؤه (Dexie + Zod).
- تنظيف git: 1763 ملف `node_modules` + `__pycache__` أُزيلت من التتبع (17812→~40 ملف متتبع).
- إصلاح CI: `node --test` glob + إزالة cache المتضارب.
- HF Space `wisam99/talky` أُعيد تشغيله (was PAUSED) ورفعه عبر `upload_folder`; GitHub Pages ينشر تلقائياً 200.
- الاختبارات: 66 pytest + 38 node — جميعها PASS محلياً.