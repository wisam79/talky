/**
 * gradio_api.js — Direct Gradio REST API client for k2-fsa/OmniVoice
 * Replaces the Python backend proxy entirely.
 * 
 * CRITICAL FIXES APPLIED:
 * - Paths fixed to /gradio_api/... (was /call/... → 404)
 * - SSE handling matches real OmniVoice wire format:
 *   event: complete → data: [audioData, status]
 *   event: error    → data: null | {msg: "..."}
 *   event: process_generating/process_starts → progress_data
 */

const OMNIVOICE_BASE = "https://k2-fsa-omnivoice.hf.space";
const OMNIVOICE_API   = `${OMNIVOICE_BASE}/gradio_api/call/_clone_fn`;
const OMNIVOICE_UPLOAD = `${OMNIVOICE_BASE}/gradio_api/upload`;

/**
 * Upload a File object to the Gradio Space and get back its server path.
 * @param {File} file
 * @param {AbortSignal} [signal] — cancels the upload fetch
 * @returns {Promise<Object>} Gradio FileData object
 */
async function uploadToGradio(file, signal) {
  const fd = new FormData();
  fd.append("files", file);
  const res = await fetch(OMNIVOICE_UPLOAD, {
    method: "POST",
    body: fd,
    signal: signal || undefined
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  const paths = await res.json();   // returns ["/tmp/gradio/xxx/filename"]
  return {
    path: paths[0],
    orig_name: file.name,
    meta: { _type: "gradio.FileData" }
  };
}

/**
 * Generate voice using OmniVoice directly from the browser.
 * @param {Object} params
 * @param {AbortSignal} [params.signal] — optional signal to cancel SSE/fetch
 * @param {(stage: string, ratio: number|null) => void} [params.onProgress] — real progress callback
 *   stages: 'upload' | 'queued' | 'generating' | 'downloading' | 'done'
 * @returns {Promise<string>} Object URL of the generated audio blob
 */
async function generateVoiceGradio({
  text, language = "Auto", refAudio = null, refText = "",
  instruct = "", ns = 32, gs = 2.0, dn = true, sp = 1.0,
  du = null, pp = true, po = true, signal = null, onProgress = null
}) {
  const emit = (stage, ratio) => { try { if (onProgress) onProgress(stage, ratio); } catch (_) {} };
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Step 1: Upload reference audio if provided
  let refAudioData = null;
  if (refAudio instanceof File && refAudio.size > 0) {
    emit('upload', null);
    refAudioData = await uploadToGradio(refAudio, signal);
  } else if (refAudio && typeof refAudio === 'object' && refAudio.path) {
    // Pre-built Gradio FileData — pass through directly
    refAudioData = refAudio;
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Step 2: Submit prediction
  emit('queued', 0.05);
  const submitRes = await fetch(OMNIVOICE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [text, language, refAudioData, refText, instruct,
             ns, gs, dn, sp, du, pp, po]
    }),
    signal: signal || undefined
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => submitRes.statusText);
    throw new Error(`OmniVoice submission failed: ${errText}`);
  }

  const { event_id } = await submitRes.json();
  if (!event_id) throw new Error("No event_id returned from OmniVoice");

  // Step 3: Stream result via SSE (real wire format)
  return new Promise((resolve, reject) => {
    const es = new EventSource(`${OMNIVOICE_API}/${event_id}`);
    let settled = false;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      es.close();
      reject(error);
    };
    const timeout = setTimeout(() => {
      es.close();
      finishReject(new Error("OmniVoice timeout — حاول مرة أخرى"));
    }, 180_000); // 3 minute timeout

    const onAbort = () => {
      finishReject(new DOMException("Aborted", "AbortError"));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // --- SSE handlers matching real Gradio 6 wire format ---

    // Named event: completion with [audioData, status]
    es.addEventListener("complete", async (ev) => {
      clearTimeout(timeout);
      es.close();
      try {
        const payload = JSON.parse(ev.data); // payload is an array: [audioData, status]
        if (!Array.isArray(payload) || payload.length < 1) {
          throw new Error("Unexpected completion payload format");
        }
        const audioData = payload[0];
        if (!audioData) throw new Error("لا يوجد صوت في الرد");

        // Audio URL — Gradio returns either .url (absolute or relative) or .path
        let audioUrl = audioData.url;
        if (!audioUrl && audioData.path) {
          audioUrl = `${OMNIVOICE_BASE}/gradio_api/file=${audioData.path}`;
        }
        if (!audioUrl) throw new Error("رابط الصوت مفقود في الرد");
        // Resolve relative URLs against the space origin
        if (audioUrl.startsWith("/")) {
          audioUrl = `${OMNIVOICE_BASE}${audioUrl}`;
        }

        emit('downloading', 0.92);
        const audioRes = await fetch(audioUrl);
        if (!audioRes.ok) throw new Error(`فشل تحميل ملف الصوت: ${audioRes.status}`);
        const audioBlobRaw = await audioRes.blob();
        emit('done', 1);
        settled = true;
        resolve(URL.createObjectURL(audioBlobRaw));
      } catch (e) {
        finishReject(e);
      }
    });

    // Gradio uses the same event name for application and connection errors.
    es.addEventListener("error", (ev) => {
      let msg = "OmniVoice error";
      if (ev.data && ev.data !== "null") {
        try {
          const d = JSON.parse(ev.data);
          if (d?.msg) msg = d.msg;
        } catch (_) {}
      }
      if (!ev.data) msg = "تعذّر الاتصال بـ OmniVoice — تحقق من الشبكة";
      finishReject(new Error(msg));
    });

    es.addEventListener("process_failed", (ev) => {
      let msg = "فشل توليد الصوت";
      if (ev.data) {
        try {
          const data = JSON.parse(ev.data);
          msg = data?.msg || data?.error || msg;
        } catch (_) {}
      }
      finishReject(new Error(msg));
    });

    es.addEventListener("close_stream", () => {
      finishReject(new Error("انتهى اتصال OmniVoice قبل اكتمال التوليد"));
    });

    // Progress events (optional, for better UX)
    const handleProgress = (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        const pd = payload?.progress_data;
        if (!pd) return;
        let ratio = null;
        if (Array.isArray(pd) && pd.length > 0) {
          const first = pd[0];
          if (typeof first?.index === 'number' && typeof first?.length === 'number' && first.length > 0) {
            ratio = Math.min(0.9, Math.max(0.1, first.index / first.length));
          } else if (typeof first?.progress === 'number') {
            ratio = Math.min(0.9, Math.max(0.1, first.progress));
          }
        }
        emit('generating', ratio);
      } catch (_) {}
    };
    es.addEventListener("process_generating", handleProgress);
    es.addEventListener("process_starts", handleProgress);

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}