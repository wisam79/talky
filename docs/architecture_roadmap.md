# Talky — المواصفة المعمارية وخارطة الطريق التنفيذية

*استوديو توليد الأصوات العربية بالذكاء الاصطناعي · Technical Architecture & Implementation Roadmap · الإصدار 1.0 · 31 أكتوبر 2026*

## 0. الملخص التنفيذي

**Talky** استوديو ويب عربي لتوليد كلام بشري واقعي واستنساخ النبرات. يقوم V1 على ثلاث ركائز:

1. **واجهة Static SPA** (Vite + React + TypeScript + Tailwind) على GitHub Pages، بلا خادم تطبيقات.
2. **دالة GPU واحدة على Modal** تشغّل SILMA TTS وتكشف نقطة نهاية FastAPI واحدة.
3. **معمارية عديمة الحالة**: لا قاعدة بيانات؛ الشخصيات الافتراضية في `voices.json`، والمخصصة في IndexedDB، وكل طلب توليد يحمل كل ما يلزم (النص + العينة المرجعية + نصها) في جسم JSON واحد.

الفكرة التي تجعل الانتقال إلى V2 رخيصاً: **نثبّت العقود (Contracts) والحدود بين الطبقات الآن**، فيتحول التخزين المحلي إلى سحابي بتبديل مُحوِّل (Adapter) واحد لا بإعادة كتابة.

### 0.1 القرارات الحاكمة

| المحور | القرار | الملاحظة المعمارية |
| --- | --- | --- |
| النموذج | `silma-ai/silma-tts` (150M، مبني على F5-TTS) | استنساخ فوري بعينة قصيرة، وتشكيل آلي |
| الاستضافة | Modal Serverless، GPU من نوع T4 (يُقارَن بـ L4 في المرحلة 1) | فوترة بالثانية، و`min_containers=0` |
| الواجهة | Vite + React + TS + Tailwind، RTL-first | Wavesurfer.js + Lucide Icons |
| النشر | GitHub Pages + GitHub Actions | SPA بتوجيه Hash |
| الحالة | بلا قاعدة بيانات | IndexedDB للأصوات المخصصة |
| العقود | `apiVersion: 1` + اتحاد مميَّز لمصدر الصوت | يسمح بإضافة صوت مخزَّن في V2 دون كسر |

### 0.2 نتائج التحقق من المعطيات التقنية (31 أكتوبر 2026)

راجعتُ بطاقة النموذج وصفحات تسعير Modal قبل كتابة الوثيقة. هذه النتائج تؤثر مباشرة على التصميم:

- **واجهة النموذج البرمجية:** `SilmaTTS().infer(ref_file, ref_text, gen_text, file_wave, seed, speed)` تعيد `(wav, sr, spec)`. النص المرجعي `ref_text` اختياري؛ إن تُرك فارغاً يُفرَّغ آلياً، وهذا يضيف زمناً وتبعية، لذا نجعله إلزامياً في واجهتنا.
- **الاستنساخ:** تكفي عينة أقل من 8 ثوانٍ بحسب الشركة. وسرعة الاستدلال المعلنة RTF ≈ 0.12 كانت على RTX 4090، وهي **لا تنطبق تلقائياً على T4**؛ لذلك القياس مهمة صريحة في المرحلة 1.
- **التشكيل والتطبيع:** يعتمد المشروع على CATT للتشكيل التلقائي عند غيابه، وعلى NeMo Text Processing لتطبيع النص. هاتان تبعيتان ثقيلتان تكبّران الصورة وتبطئان الإقلاع، ويجب تضمينهما (مع أوزانهما) في الصورة وقت البناء لا تنزيلهما أثناء التشغيل.
- **المتطلبات:** `pip install silma-tts` و`ffmpeg`. الأوزان بترخيص Apache-2.0 والكود بترخيص MIT.
- **شروط الاستخدام المسؤول:** تشترط بطاقة النموذج موافقة موثقة من صاحب الصوت، وعدم الاحتيال أو التضليل، والإفصاح عن أن الصوت مولَّد آلياً. أدمجنا ذلك في المنتج كمتطلب وظيفي (انظر §8.3).
- **Modal:** سعر T4 نحو 0.000164$ للثانية (≈ 0.59$ للساعة) إضافة إلى CPU والذاكرة. خطة Starter مجانية بـ 30$ رصيداً شهرياً وحد 10 وحدات GPU متزامنة. تُراجَع الأرقام قبل الإطلاق لأنها تتغير.
- **سقف الجودة:** هدف «جودة تضاهي ElevenLabs» طموح لنموذج بحجم 150M؛ لذلك نعرّف في المرحلة 1 معيار قبول قابلاً للقياس (اختبار استماع أعمى على نصوص ثابتة) بدل افتراض التكافؤ.

> **ملاحظة منهجية:** أُخذت تفاصيل الـ API من نسخة مطابقة لبطاقة النموذج. يُثبَّت إصدار `silma-tts` ويُعاد التحقق من توقيع `infer` من المستودع الرسمي في أول يوم من المرحلة 1.

## 1. النظرة المعمارية

### 1.1 المخطط

```text
[Browser · GitHub Pages · Static SPA]
  UI (React + Zustand)
   ├─ VoiceManager ──► VoiceRepository
   │                    ├─ built-in : voices.json + /samples/*.wav
   │                    └─ custom   : IndexedDB
   ├─ AudioService   record · decode · resample · validate · concat · encode
   └─ ModalClient    fetch · retry · abort · phase events
          │
          │  HTTPS  POST /v1/generate  (JSON: text + ref audio base64 + ref text)
          ▼
[Modal · Serverless GPU (T4)]
  FastAPI + CORS ─► validate ─► normalize ref audio (ffmpeg) ─► SilmaTTS.infer
                  ─► encode WAV/MP3 ─► JSON { audio base64, meta }
  weights baked into the image · model loaded once per container
```

### 1.2 تدفق الطلب

1. يختار المستخدم شخصية ويكتب نصاً؛ يُرجع `VoiceManager` عينة مرجعية جاهزة (WAV بتردد 24kHz أحادي القناة + `refText`).
2. يبني `ModalClient` الطلب `GenerateRequest` ويرسله إلى `POST /v1/generate` مع `AbortSignal` ومهلة.
3. يتحقق الخادم من الحدود (النص والعينة) ويطبّع العينة عبر ffmpeg إلى 24kHz أحادي 16-bit.
4. يولّد `SilmaEngine` الموجة الصوتية (مع التشكيل الآلي عند الحاجة).
5. يرمّز الخادم الناتج WAV أو MP3 ويعيد JSON فيه الصوت Base64 وبيانات القياس (`timings`, `coldStart`).
6. يفكّ `AudioService` الترميز إلى `Blob` ويمرره إلى Wavesurfer للعرض، فيتاح الاستماع الفوري والتحميل.

### 1.3 مبادئ حاكمة

- **العقد أولاً:** أي تغيير في `GenerateRequest` أو `GenerateResponse` يمرّ بمراجعة، ويُرفع `apiVersion` عند كل كسر.
- **الخادم لا يثق بالعميل:** كل تحقق في الواجهة يُكرَّر في الخادم.
- **المنافذ والمحوّلات (Ports & Adapters):** `VoiceRepository` و`TtsEngine` واجهتان تتبدل التنفيذات خلفهما.
- **اتجاه اعتماد أحادي:** `features → state → services → domain`؛ والخدمات لا تستورد من الواجهة أبداً.
- **الفشل جزء من التصميم:** لكل حالة خطأ رمز ورسالة عربية وسلوك إعادة محاولة محدد.

### 1.4 ميزانية الحمولة (Payload Budget)

| العنصر | الحساب | الحجم التقريبي |
| --- | --- | --- |
| عينة مرجعية 8 ثوانٍ (24kHz، أحادي، 16-bit) | 48,000 بايت/ث | 375 KB (≈ 500 KB بعد Base64) |
| عينة مرجعية 10 ثوانٍ (الحد الأقصى الموصى به) | 48,000 بايت/ث | 470 KB (≈ 625 KB بعد Base64) |
| ناتج WAV بطول 30 ثانية | 48,000 بايت/ث | 1.4 MB (≈ 1.9 MB بعد Base64) |
| ناتج MP3 بجودة 128kbps وبطول 30 ثانية | 16,000 بايت/ث | 470 KB (≈ 625 KB بعد Base64) |

هذه الأحجام مقبولة لـ JSON مع Base64 في V1. تحسينات لاحقة غير كاسرة: استجابة ثنائية `audio/wav` مع البيانات الوصفية في الترويسات، وضغط العينة المرجعية بـ Opus أو FLAC لتقليل الرفع.

## 2. هيكل المشروع

### 2.1 شجرة المجلدات

```text
talky/
├─ README.md
├─ docs/
│   ├─ adr/0001-stateless-v1.md          # سجل القرارات المعمارية
│   ├─ api/openapi.json                  # مُولَّد من FastAPI
│   └─ benchmarks/phase1.md
├─ backend/
│   └─ modal/
│       ├─ app.py                        # تعريف App والصورة والفئة
│       ├─ talky/
│       │   ├─ api.py                    # مسارات FastAPI + CORS
│       │   ├─ schemas.py                # نماذج Pydantic (مرآة العقود)
│       │   ├─ engine.py                 # TtsEngine (منفذ) + SilmaEngine (محوّل)
│       │   ├─ audio.py                  # ffmpeg: تطبيع/ترميز/فحص
│       │   ├─ limits.py                 # الحدود والثوابت
│       │   ├─ security.py               # التوكن وتحديد المعدل
│       │   └─ errors.py                 # TalkyError + رموز الأخطاء
│       ├─ scripts/
│       │   ├─ cli_generate.py           # اختبار التوليد عبر CLI
│       │   └─ benchmark.py              # قياس الإقلاع والزمن وRTF
│       ├─ tests/
│       └─ requirements.txt
├─ frontend/
│   ├─ index.html
│   ├─ vite.config.ts
│   ├─ tailwind.config.ts
│   ├─ public/
│   │   ├─ voices.json                   # الشخصيات الافتراضية
│   │   └─ samples/*.wav                 # عينات مرجعية 24kHz
│   └─ src/
│       ├─ main.tsx
│       ├─ app/                          # الهيكل العام، التوجيه، المزوّدات
│       ├─ config/                       # env.ts, audio.config.ts, features.ts
│       ├─ domain/                       # types.ts, errors.ts (بلا اعتماديات)
│       ├─ services/
│       │   ├─ audio/                    # AudioService, recorder, validators, wav
│       │   ├─ voices/                   # VoiceManager, VoiceRepository,
│       │   │                            # LocalVoiceRepository, BuiltinVoiceSource
│       │   └─ api/                      # ModalClient, retry, errorMapper
│       ├─ storage/db.ts                 # مخطط IndexedDB (idb)
│       ├─ state/                        # مخازن Zustand
│       ├─ features/                     # editor/, voices/, recorder/, player/
│       ├─ components/ui/                # مكوّنات عامة
│       └─ styles/
└─ .github/workflows/
    ├─ ci.yml
    ├─ deploy-frontend.yml
    └─ deploy-modal.yml
```

### 2.2 مسؤوليات الطبقات وحدودها

| الوحدة | المسؤولية | حدودها (ما لا تفعله) |
| --- | --- | --- |
| `AudioService` | التسجيل، فك الترميز، إعادة أخذ العينات إلى 24kHz أحادي، تحليل جودة العينة، دمج WAV وترميز MP3 | لا تعرف الشبكة ولا التخزين ولا React |
| `VoiceManager` | واجهة موحّدة للشخصيات (افتراضية + مخصصة)، وتجهيز `reference` للطلب، وتخزين مؤقت في الذاكرة | لا تستدعي Modal ولا تلمس DOM |
| `ModalClient` | HTTP، المهلات، الإلغاء، إعادة المحاولة، ترجمة الأخطاء إلى `TalkyError`، أحداث مراحل التوليد | لا يعرف IndexedDB ولا الواجهة |
| `VoiceRepository` | منفذ (Port) للحفظ والقراءة. V1: IndexedDB، V2: سحابي | لا يحتوي منطق أعمال |
| `state/` و`features/` | تنسيق السيناريوهات وعرضها | لا HTTP مباشر ولا معالجة صوت |

## 3. عقود البيانات والواجهات البرمجية

### 3.1 تعريفات TypeScript

```ts
// frontend/src/domain/types.ts
export type AudioFormat = 'wav' | 'mp3';
export type VoiceSource = 'builtin' | 'custom';

/** مصدر عينة الشخصية: ملف ثابت (افتراضية) أو Blob في IndexedDB (مخصصة). */
export type VoiceSample =
  | { kind: 'url'; url: string }
  | { kind: 'blob'; blob: Blob; durationMs: number };

export interface VoicePersona {
  id: string;                    // 'builtin:nour' | 'custom:<uuid>'
  source: VoiceSource;
  name: string;
  description?: string;
  language: 'ar' | 'ar-en';
  gender?: 'female' | 'male' | 'neutral';
  tags?: string[];
  sample: VoiceSample;
  refText: string;               // نص العينة مطابقاً لما يُقال حرفياً (يُفضَّل مشكَّلاً)
  consent?: { confirmedAt: string; statement: string }; // إلزامي للمخصصة
  createdAt: string;             // ISO 8601
  updatedAt: string;
  schemaVersion: 1;
}

export interface ReferencePayload {
  audioBase64: string;           // WAV 24kHz أحادي 16-bit، بلا بادئة data:
  mimeType: 'audio/wav';
  refText: string;
}

export interface GenerateOptions {
  speed?: number;                // 0.7–1.3، الافتراضي 1
  seed?: number | null;
  format?: AudioFormat;          // الافتراضي 'wav'
}

export interface GenerateRequest {
  apiVersion: 1;
  requestId: string;             // UUID v4 للتتبع
  text: string;                  // 1..600 حرف (انظر §4.5)
  voice: { type: 'inline'; reference: ReferencePayload };
  // اتحاد مميَّز: V2 يضيف { type: 'stored'; voiceId: string } دون كسر العقد
  options?: GenerateOptions;
  client?: { app: 'talky-web'; version: string };
}

export type ErrorCode =
  | 'INVALID_REQUEST' | 'TEXT_EMPTY' | 'TEXT_TOO_LONG'
  | 'REF_AUDIO_INVALID' | 'REF_AUDIO_TOO_SHORT' | 'REF_AUDIO_TOO_LONG' | 'REF_AUDIO_TOO_QUIET'
  | 'PAYLOAD_TOO_LARGE' | 'UNAUTHORIZED' | 'RATE_LIMITED'
  | 'MODEL_ERROR' | 'SERVICE_UNAVAILABLE' | 'TIMEOUT'
  | 'NETWORK_ERROR' | 'ABORTED';   // الأخيران يُولَّدان في العميل فقط

export interface ApiError {
  code: ErrorCode;
  message: string;               // إنجليزي للسجلات
  messageAr: string;             // يُعرض للمستخدم
  retryable: boolean;
  retryAfterMs?: number;
  details?: Record<string, unknown>;
}

export interface GenerateSuccess {
  ok: true;
  apiVersion: 1;
  requestId: string;
  audio: {
    base64: string;
    format: AudioFormat;
    mimeType: 'audio/wav' | 'audio/mpeg';
    sampleRate: number;
    durationMs: number;
  };
  meta: {
    model: string;               // 'silma-tts-v1'
    coldStart: boolean;
    seed?: number | null;        // إن وفّره المحرك
    timings: { inferMs: number; encodeMs: number; totalMs: number };
  };
}

export interface GenerateFailure {
  ok: false;
  apiVersion: 1;
  requestId: string;
  error: ApiError;
}

export type GenerateResponse = GenerateSuccess | GenerateFailure;

export type GenerationPhase =
  | 'idle' | 'preparing' | 'connecting' | 'warming'
  | 'generating' | 'decoding' | 'ready' | 'error';
```

### 3.2 نقاط النهاية والترويسات

| المسار | الوصف |
| --- | --- |
| `GET /v1/health` | يوقظ الحاوية دون استدلال، ويعيد `{ ok, model, version, warm }` |
| `POST /v1/generate` | يستقبل `GenerateRequest` ويعيد `GenerateResponse` |
| `POST /v1/auth/turnstile` | يتحقق من تحدّي Turnstile ويعيد توكناً قصير العمر (انظر §8) |

- الحالة `200` تعني `GenerateSuccess`. وأي `4xx` أو `5xx` يعيد `GenerateFailure` بنفس الغلاف، مع ترويسة `Retry-After` عند `429` و`503`.
- ترويسة التفويض: `Authorization: Bearer <token>`. نمرّرها منذ V1 عبر واجهة `AuthProvider` داخل `ModalClient` ليصبح استبدالها بـ JWT في V2 تغييراً في مكان واحد.

### 3.3 ملف الشخصيات الافتراضية `voices.json`

```json
{
  "schemaVersion": 1,
  "voices": [
    {
      "id": "builtin:nour",
      "name": "نور",
      "description": "صوت نسائي هادئ للسرد والقراءة",
      "language": "ar",
      "gender": "female",
      "tags": ["سرد", "فصيح"],
      "sampleUrl": "samples/nour.24k.wav",
      "refText": "نصُّ العينةِ المسجَّلةِ مكتوبٌ هنا حرفياً ومشكَّلاً."
    }
  ]
}
```

قواعد العينات الافتراضية: ملف WAV بتردد 24kHz أحادي القناة، طوله 5 إلى 8 ثوانٍ (≤ 400 KB)، و`refText` مطابق حرفياً ومشكَّل، وعددها لا يتجاوز 8 شخصيات في V1 للحفاظ على خفة الموقع. **يجب أن تكون العينات مسجَّلة بموافقة موثقة أو برخصة تسمح بالاستخدام التجاري**، وتُحفظ الوثيقة في `docs/`.
