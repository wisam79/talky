/**
 * gradio_api.js — Direct Gradio REST API client for k2-fsa/OmniVoice
 * Replaces the Python backend proxy entirely.
 */

const OMNIVOICE_BASE = "https://k2-fsa-omnivoice.hf.space";
const OMNIVOICE_API  = `${OMNIVOICE_BASE}/call/_clone_fn`;
const OMNIVOICE_UPLOAD = `${OMNIVOICE_BASE}/upload`;

/**
 * Upload a File object to the Gradio Space and get back its server path.
 * @param {File} file
 * @returns {Promise<Object>} Gradio FileData object
 */
async function uploadToGradio(file) {
  const fd = new FormData();
  fd.append("files", file);
  const res = await fetch(OMNIVOICE_UPLOAD, { method: "POST", body: fd });
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
 * @returns {Promise<string>} Object URL of the generated audio blob
 */
async function generateVoiceGradio({
  text, language = "Auto", refAudio = null, refText = "",
  instruct = "", ns = 32, gs = 2.0, dn = true, sp = 1.0,
  du = null, pp = true, po = true
}) {
  // Step 1: Upload reference audio if provided
  let refAudioData = null;
  if (refAudio instanceof File && refAudio.size > 0) {
    refAudioData = await uploadToGradio(refAudio);
  }

  // Step 2: Submit prediction
  const submitRes = await fetch(OMNIVOICE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [text, language, refAudioData, refText, instruct,
             ns, gs, dn, sp, du, pp, po]
    })
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => submitRes.statusText);
    throw new Error(`OmniVoice submission failed: ${errText}`);
  }

  const { event_id } = await submitRes.json();
  if (!event_id) throw new Error("No event_id returned from OmniVoice");

  // Step 3: Stream result via SSE
  return new Promise((resolve, reject) => {
    const es = new EventSource(`${OMNIVOICE_API}/${event_id}`);
    const timeout = setTimeout(() => {
      es.close();
      reject(new Error("OmniVoice timeout — حاول مرة أخرى"));
    }, 180_000); // 3 minute timeout

    es.addEventListener("error", (ev) => {
      // Try to parse the error data first
      if (ev.data) {
        try {
          const d = JSON.parse(ev.data);
          clearTimeout(timeout);
          es.close();
          reject(new Error(d?.msg || "OmniVoice error"));
          return;
        } catch (_) {}
      }
      clearTimeout(timeout);
      es.close();
      reject(new Error("تعذّر الاتصال بـ OmniVoice"));
    });

    es.onmessage = async (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch (_) { return; }

      if (d.msg === "process_completed") {
        clearTimeout(timeout);
        es.close();
        try {
          // Output: [audio_data, status_str]
          const audioData = d.output?.data?.[0];
          if (!audioData) throw new Error("لا يوجد صوت في الرد");

          // The audio URL — Gradio returns either .url or we build from .path
          const audioUrl = audioData.url ||
            `${OMNIVOICE_BASE}/gradio_api/file=${audioData.path}`;

          const audioRes = await fetch(audioUrl);
          if (!audioRes.ok) throw new Error("فشل تحميل ملف الصوت");
          const audioBlobRaw = await audioRes.blob();
          resolve(URL.createObjectURL(audioBlobRaw));
        } catch (e) {
          reject(e);
        }
      } else if (d.msg === "process_generating") {
        // partial progress — ignore, wait for completed
      }
    };
  });
}
