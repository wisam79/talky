/* =====================================================================
   TALKY ENGINE — app.js
   Features: Tabs • Word Counter • Presets • Live Recording •
             TTS Generation • Waveform • Speed Control • Ambience •
             IndexedDB Archive • Podcast Mode • Toast System
   ===================================================================== */

(function () {
  'use strict';

   /* ================================================================
      GLOBALS
      ================================================================ */
  let currentAudioBlob = null;
  let ambienceCtx = null;
  let ambienceSource = null;
  let ambienceGain = null;
  let ambienceOscillator = null; // Track the forest bird oscillator
  let audioContext = null; // Reusable AudioContext for autoplay compliance
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordTimerInterval = null;
  let recordSeconds = 0;
  let podcastBlobs = []; // [{char, text, blob}]
  let abortCtrl = null;   // current generation AbortController
  let sharedAudioCtx = null; // reused for merge + waveform (avoids context leak)

  function getSharedAudioCtx() {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(() => {});
    return sharedAudioCtx;
  }
  const DB_NAME = 'talky_history';
  const DB_STORE = 'generations';
  const z = window.TalkyLibs?.Zod;
  const generationSchema = z?.object({
    text: z.string().trim().min(1, 'الرجاء إدخال نص للتحويل.').max(5000, 'النص طويل جداً.'),
    language: z.string().default('Auto'),
    role: z.string().default('Auto'),
    gender: z.string().default('Auto'),
    accent: z.string().default('Auto'),
    dialect: z.string().default('Auto'),
    speed: z.coerce.number().min(0.5).max(2),
    steps: z.coerce.number().int().min(8).max(64),
    guidance: z.coerce.number().min(0.5).max(5),
  });

  /* Split long text on sentence boundaries (Arabic + Latin punctuation) */
  function splitTextSmart(text, maxChars) {
    const sentences = text.match(/[^.!؟?؛;\n]+[.!؟?؛;\n]?/g) || [text];
    const chunks = [];
    let cur = '';
    for (const s of sentences) {
      if ((cur + s).length > maxChars && cur.trim()) { chunks.push(cur.trim()); cur = s; }
      else cur += s;
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.length ? chunks : [text];
  }

  /* Merge multiple wav blobs into one by decoding + concatenating PCM */
  async function mergeAudioBlobs(blobs) {
    let ctx = null;
    let ownsCtx = false;
    try {
      try {
        ctx = getSharedAudioCtx();
      } catch (_) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        ownsCtx = true;
      }
      const buffers = [];
      for (const b of blobs) {
        const ab = await b.arrayBuffer();
        buffers.push(await ctx.decodeAudioData(ab.slice(0)));
      }
      const sampleRate = buffers[0].sampleRate;
      const channels = buffers[0].numberOfChannels;
      let totalLen = 0;
      buffers.forEach(bf => {
        const duration = Number.isFinite(bf.duration) ? bf.duration : bf.length / bf.sampleRate;
        totalLen += Math.round(duration * sampleRate);
      });
      const out = ctx.createBuffer(channels, totalLen, sampleRate);
      let offset = 0;
      for (const bf of buffers) {
        const duration = Number.isFinite(bf.duration) ? bf.duration : bf.length / bf.sampleRate;
        const targetLength = Math.round(duration * sampleRate);
        for (let c = 0; c < channels; c++) {
          const source = bf.getChannelData(Math.min(c, bf.numberOfChannels - 1));
          const target = out.getChannelData(c);
          if (bf.sampleRate === sampleRate) {
            target.set(source.subarray(0, targetLength), offset);
            continue;
          }
          const ratio = (source.length - 1) / Math.max(1, targetLength - 1);
          for (let i = 0; i < targetLength; i++) {
            const position = i * ratio;
            const left = Math.floor(position);
            const right = Math.min(left + 1, source.length - 1);
            const fraction = position - left;
            target[offset + i] = source[left] * (1 - fraction) + source[right] * fraction;
          }
        }
        offset += targetLength;
      }
      const wavBlob = audioBufferToWav(out);
      if (ownsCtx) await ctx.close().catch(()=>{});
      return wavBlob;
    } catch (e) {
      console.warn('Merge failed, returning first chunk:', e);
      if (ownsCtx && ctx) await ctx.close().catch(()=>{});
      return blobs[0];
    }
  }

  function audioBufferToWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const len = buffer.length * numCh * 2 + 44;
    const ab = new ArrayBuffer(len);
    const v = new DataView(ab);
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF'); v.setUint32(4, len - 8, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * numCh * 2, true); v.setUint16(32, numCh * 2, true);
    v.setUint16(34, 16, true); writeStr(36, 'data'); v.setUint32(40, len - 44, true);
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
        v.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  // Initialize AudioContext on first user interaction (autoplay policy compliance)
  function initAudioContext() {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
  }

  /* ================================================================
      0b. BACKEND PROXY (use when TALKY_CONFIG.apiBase is set)
      ================================================================ */
  async function generateVoiceViaBackend({
    text, language = 'Auto', dialect = 'Auto', gender = 'Auto', role = 'Auto', accent = 'Auto',
    refAudio = null, refText = '', speed = 1.0, steps = 32, guidance = 2.0, signal = null, onProgress = null
  }) {
    const cfg = window.TALKY_CONFIG || {};
    const base = (cfg.apiBase || '').replace(/\/+$/, '');
    if (!base) throw new Error('الباكند غير مُهيأ');
    const fd = new FormData();
    fd.append('text', text);
    fd.append('language', language);
    fd.append('dialect', dialect);
    fd.append('gender', gender);
    fd.append('role', role);
    fd.append('accent', accent);
    fd.append('ref_text', refText || '');
    fd.append('speed', String(speed));
    fd.append('steps', String(steps));
    fd.append('guidance', String(guidance));
    if (refAudio instanceof File && refAudio.size > 0) fd.append('ref_audio', refAudio, refAudio.name);
    if (onProgress) try { onProgress('queued', 0.1); } catch (_) {}
    const res = await fetch(base + '/api/generate', { method: 'POST', body: fd, signal: signal || undefined });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      if (res.status === 429) {
        const ra = res.headers.get('Retry-After');
        throw new Error('تم تجاوز الحد المسموح' + (ra ? ` — حاول بعد ${ra} ثانية.` : '.'));
      }
      throw new Error(txt || ('فشل الباكند: ' + res.status));
    }
    if (onProgress) try { onProgress('downloading', 0.9); } catch (_) {}
    const blob = await res.blob();
    if (onProgress) try { onProgress('done', 1); } catch (_) {}
    return URL.createObjectURL(blob);
  }

  async function generateVoiceUnified(opts) {
    const cfg = window.TALKY_CONFIG || { directMode: true };
    if (!cfg.directMode && cfg.apiBase) return generateVoiceViaBackend(opts);
    return generateVoiceGradio(opts);
  }

  /* ================================================================
      0. THEME (dark/light with localStorage persistence)
      ================================================================ */
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('talky_theme', t); } catch (_) {}
    if (themeIcon) themeIcon.querySelector('use').setAttribute('href', t === 'light' ? '#i-sun' : '#i-moon');
  }
  (function initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem('talky_theme') || 'dark'; } catch (_) {}
    applyTheme(saved);
  })();
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(cur);
      showToast(cur === 'light' ? 'الوضع الفاتح' : 'الوضع الداكن', 'info');
    });
  }

  /* ================================================================
     1. TAB NAVIGATION
     ================================================================ */
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      tabContents.forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const content = document.getElementById('tab-' + target);
      content.style.display = 'flex';
      content.classList.add('active');

      if (target === 'history') renderHistory();
    });
  });

  /* ================================================================
     2. WORD COUNTER & DURATION ESTIMATOR
     ================================================================ */
  const textArea = document.getElementById('text');
  const wordCountEl = document.getElementById('word-count');
  const durationEstEl = document.getElementById('duration-estimate');
  const charCountEl = document.getElementById('char-count');

  textArea.addEventListener('input', updateWordCount);

  function updateWordCount() {
    const words = textArea.value.trim().split(/\s+/).filter(Boolean);
    const count = words.length;
    wordCountEl.textContent = count + ' كلمة';
    if (charCountEl) {
      const chars = textArea.value.length;
      charCountEl.textContent = `${chars}/5000`;
      charCountEl.classList.toggle('text-limit-warning', chars >= 4500);
      charCountEl.classList.toggle('text-limit-error', chars >= 5000);
    }
    // Arabic TTS: ~2 words/second on average
    const secs = Math.round(count / 2);
    if (secs < 60) {
      durationEstEl.textContent = `~ ${secs} ث`;
    } else {
      const m = Math.floor(secs / 60), s = secs % 60;
      durationEstEl.textContent = `~ ${m} د ${s > 0 ? s + ' ث' : ''}`;
    }
  }

  /* ================================================================
     3. VOICE PRESETS
     ================================================================ */
  const presetBtns = document.querySelectorAll('.preset-btn');
  const roleInput = document.getElementById('role');
  const genderInput = document.getElementById('gender');
  const roleSelect = document.getElementById('role'); // hidden input

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      roleInput.value = btn.dataset.role;
      genderInput.value = btn.dataset.gender;
      // Sync advanced options dropdowns
    });
  });

  /* ================================================================
     3b. VOICE FAVORITES (localStorage) + DOC IMPORT (txt/md/srt/vtt)
     ================================================================ */
  const FAV_KEY = 'talky_favs';
  function getFavs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (_) { return []; }
  }
  function setFavs(f) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(f.slice(0, 12))); } catch (_) {}
  }
  function currentVoiceConfig() {
    const f = new FormData(generateForm);
    return {
      name: 'تشكيلة ' + (getFavs().length + 1),
      language: f.get('language') || 'Auto',
      role: f.get('role') || 'Auto',
      gender: f.get('gender') || 'Auto',
      accent: f.get('accent') || 'Auto',
      dialect: f.get('dialect') || 'Auto',
      speed: f.get('speed') || '1.0',
      steps: f.get('steps') || '32',
      guidance: f.get('guidance') || '2.0'
    };
  }
  function applyVoiceConfig(c) {
    const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.value = v; };
    set('language', c.language); set('role', c.role);
    set('gender', c.gender);
    set('accent', c.accent); set('dialect', c.dialect);
    set('speed-input', c.speed); set('steps-input', c.steps); set('guidance-input', c.guidance);
    // refresh slider labels
    [['speed-input','speed-val',v=>parseFloat(v).toFixed(1)+'x'],
     ['steps-input','steps-val',v=>v],
     ['guidance-input','guidance-val',v=>parseFloat(v).toFixed(1)]].forEach(([inp,lbl,fmt])=>{
      const i=document.getElementById(inp), l=document.getElementById(lbl);
      if(i&&l) l.textContent=fmt(i.value);
    });
  }
  function renderFavs() {
    const box = document.getElementById('fav-list');
    if (!box) return;
    const favs = getFavs();
    box.innerHTML = '';
    favs.forEach((f, idx) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'preset-btn fav-btn active-fav';
      b.innerHTML = '<span class="preset-icon">' + ico('star') + '</span><span class="preset-name">' + escapeHTML(f.name) + '</span>';
      b.title = 'تطبيق: ' + [f.language, f.role, f.gender].filter(x=>x&&x!=='Auto').join('، ');
      b.addEventListener('click', () => { applyVoiceConfig(f); showToast('تم تطبيق ' + f.name, 'success'); });
      b.addEventListener('contextmenu', async e => {
        e.preventDefault();
        const ok = await openModal({ title: 'حذف المفضلة', message: 'حذف ' + f.name + '؟', okText: 'حذف' });
        if (!ok) return;
        const arr = getFavs(); arr.splice(idx, 1); setFavs(arr); renderFavs();
      });
      box.appendChild(b);
    });
  }
  const saveFavBtn = document.getElementById('save-fav-btn');
  if (saveFavBtn) {
    saveFavBtn.addEventListener('click', async () => {
      const name = await openModal({
        title: 'حفظ كمفضلة', message: 'اختر اسماً للتشكيلة الحالية:',
        input: true, defaultValue: 'تشكيلتي ' + (getFavs().length + 1), okText: 'حفظ'
      });
      if (name === null) return;
      const cfg = currentVoiceConfig();
      cfg.name = (name || cfg.name).slice(0, 30);
      const arr = getFavs(); arr.push(cfg); setFavs(arr); renderFavs();
      showToast('تم حفظ المفضلة! (زر أيمن للحذف)', 'success');
    });
  }
  renderFavs();

  const docUpload = document.getElementById('doc-upload');
  if (docUpload) {
    docUpload.addEventListener('change', async () => {
      const f = docUpload.files[0];
      if (!f) return;
      if (f.size > 200 * 1024) { showToast('الملف كبير (الحد 200KB).', 'error'); return; }
      try {
        let txt = await f.text();
        // strip SRT/VTT timestamps + markdown clutter
        txt = txt.replace(/^\d+\s*\n\d{2}:\d{2}.*$/gm, '')
                 .replace(/^(WEBVTT|NOTE.*)$/gmi, '')
                 .replace(/[#*_`>\-]+/g, '')
                 .replace(/\n{3,}/g, '\n\n').trim();
        if (!txt) { showToast('لم يتم العثور على نص في الملف.', 'error'); return; }
        textArea.value = txt.slice(0, 20000);
        updateWordCount();
        const badge = document.getElementById('doc-name-badge');
        if (badge) { badge.style.display = ''; badge.innerHTML = ico('file', 'ico-sm') + ' ' + escapeHTML(f.name); }
        showToast('تم استيراد النص (' + txt.length + ' حرف).', 'success');
      } catch (e) { showToast('فشل قراءة الملف: ' + e.message, 'error'); }
      docUpload.value = '';
    });
  }

  /* ================================================================
     4. LIVE VOICE RECORDING (MediaRecorder API)
     ================================================================ */
  const recordBtn = document.getElementById('record-btn');
  const stopRecordBtn = document.getElementById('stop-record-btn');
  const recordBtnText = document.getElementById('record-btn-text');
  const recordingIndicator = document.getElementById('recording-indicator');
  const recTimerEl = document.getElementById('rec-timer');
  const refTextGroup = document.getElementById('ref-text-group');
  const fileNameBadge = document.getElementById('file-name-badge');
  const refAudioInput = document.getElementById('ref_audio');
  const dropZone = document.getElementById('drop-zone');

  recordBtn.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = handleRecordingStop;
      mediaRecorder.start();

      // UI
      recordBtn.classList.add('recording');
      recordBtnText.textContent = '⏺ جارٍ...';
      recordingIndicator.style.display = 'flex';
      recordSeconds = 0;
      updateRecTimer();
      recordTimerInterval = setInterval(() => {
        recordSeconds++;
        updateRecTimer();
        if (recordSeconds >= 30) stopRecording(); // auto-stop after 30s
      }, 1000);

      showToast('بدأ التسجيل. اضغط "إيقاف" عند الانتهاء.', 'info');
    } catch (err) {
      showToast('تعذّر الوصول إلى المايكروفون. تحقق من الصلاحيات.', 'error');
    }
  });

  stopRecordBtn.addEventListener('click', stopRecording);

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    clearInterval(recordTimerInterval);
    recordBtn.classList.remove('recording');
    recordBtnText.innerHTML = ico('mic', 'ico-sm') + ' تسجيل';
    recordingIndicator.style.display = 'none';
  }

  function handleRecordingStop() {
    const actualMime = mediaRecorder.mimeType || 'audio/webm';
    const ext = actualMime.includes('mp4') ? 'mp4' : (actualMime.includes('ogg') ? 'ogg' : 'webm');
    const blob = new Blob(recordedChunks, { type: actualMime });
    const file = new File([blob], `recorded_voice.${ext}`, { type: actualMime });

    // Inject into file input via DataTransfer
    const dt = new DataTransfer();
    dt.items.add(file);
    refAudioInput.files = dt.files;

    showFileBadge(ico('mic', 'ico-sm') + ' صوت مسجّل (' + recordSeconds + ' ث)');
    refTextGroup.style.display = 'block';
    showToast('تم حفظ التسجيل كصوت مرجعي!', 'success');
  }

  function updateRecTimer() {
    const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
    const s = String(recordSeconds % 60).padStart(2, '0');
    recTimerEl.textContent = `${m}:${s}`;
  }

  // File Upload
  if (refAudioInput) {
    refAudioInput.addEventListener('change', () => {
      if (refAudioInput.files.length > 0) {
        showFileBadge(ico('folder', 'ico-sm') + ' ' + escapeHTML(refAudioInput.files[0].name));
        if (refTextGroup) refTextGroup.style.display = 'block';
      } else {
        if (fileNameBadge) fileNameBadge.style.display = 'none';
        if (refTextGroup) refTextGroup.style.display = 'none';
      }
    });
  }

  // Drag & Drop on drop-zone label
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary-dim)'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = '';
    if (e.dataTransfer.files.length > 0) {
      const dt = new DataTransfer();
      dt.items.add(e.dataTransfer.files[0]);
      refAudioInput.files = dt.files;
      showFileBadge(ico('folder', 'ico-sm') + ' ' + escapeHTML(e.dataTransfer.files[0].name));
      refTextGroup.style.display = 'block';
    }
  });

  function showFileBadge(html) {
    fileNameBadge.innerHTML = html;
    fileNameBadge.style.display = 'inline-flex';
  }

  /* ================================================================
      5. ADVANCED OPTIONS TOGGLE
      ================================================================ */
  const advancedToggle = document.getElementById('advanced-toggle');
  const advancedContent = document.getElementById('advanced-content');
  const toggleChevron = document.getElementById('toggle-chevron');

  if (advancedToggle && advancedContent) {
    advancedToggle.addEventListener('click', () => {
      const isOpen = advancedContent.style.display !== 'none';
      advancedContent.style.display = isOpen ? 'none' : 'block';
      if (toggleChevron) toggleChevron.style.transform = isOpen ? '' : 'rotate(180deg)';
      advancedToggle.setAttribute('aria-expanded', String(!isOpen));
    });
  }

  // Advanced sliders live labels
  [['speed-input','speed-val',v=>parseFloat(v).toFixed(1)+'x'],
   ['steps-input','steps-val',v=>v],
   ['guidance-input','guidance-val',v=>parseFloat(v).toFixed(1)]].forEach(([inp,lbl,fmt])=>{
    const i=document.getElementById(inp), l=document.getElementById(lbl);
    if(i&&l) i.addEventListener('input',()=>{l.textContent=fmt(i.value);});
  });

  /* ================================================================
     6. FORM SUBMISSION — VOICE GENERATION
     ================================================================ */
  const generateForm = document.getElementById('generate-form');
  const submitBtn = document.getElementById('submit-btn');
  const btnText = submitBtn.querySelector('.btn-text');
  const btnLoading = submitBtn.querySelector('.btn-loading');
  const resultCard = document.getElementById('result-card');
  const audioPlayer = document.getElementById('audio-player');

  generateForm.addEventListener('submit', async e => {
    e.preventDefault();
    initAudioContext(); // ✅ FIXED: Initialize AudioContext on user interaction
    const text = textArea.value.trim();
    if (!text) { showToast('الرجاء إدخال نص للتحويل.', 'error'); return; }
    const hasRefAudioEarly = !!(refAudioInput && refAudioInput.files && refAudioInput.files[0]);
    if (!hasRefAudioEarly) {
      const hint = document.getElementById('ref-audio-hint');
      if (hint) { hint.style.display = 'block'; setTimeout(() => { hint.style.display = 'none'; }, 4000); }
    }

    // ✅ Long-text guard: split into chunks to avoid API limits
    const MAX_CHARS = 1200;
    let chunks = [text];
    if (text.length > MAX_CHARS) {
      chunks = splitTextSmart(text, MAX_CHARS);
      showToast(`النص طويل — سيُقسّم إلى ${chunks.length} مقاطع ثم يُدمج.`, 'info');
    }

    // ✅ AbortController for cancel + elapsed timer + REAL SSE progress
    abortCtrl = new AbortController();
    const cancelBtn = document.getElementById('cancel-btn');
    const progressTrack = document.getElementById('gen-progress-track');
    const progressFill = document.getElementById('gen-progress-fill');
    const elapsedEl = document.getElementById('gen-elapsed');
    cancelBtn.style.display = 'block';
    progressTrack.style.display = 'block';
    progressFill.style.width = '5%';
    const STAGE_LABEL = { upload: 'رفع المرجع...', queued: 'في الانتظار...', generating: 'توليد...', downloading: 'تحميل...' };
    let lastStage = '';
    const setProgress = (stage, ratio) => {
      if (stage && STAGE_LABEL[stage] && stage !== lastStage) {
        lastStage = stage;
        if (elapsedEl) elapsedEl.textContent = STAGE_LABEL[stage];
      }
      if (typeof ratio === 'number' && isFinite(ratio)) {
        progressFill.style.width = Math.round(Math.min(0.98, Math.max(0.05, ratio)) * 100) + '%';
      }
    };
    const t0 = Date.now();
    const elapsedTimer = setInterval(() => {
      // ✅ Gentle indeterminate creep ONLY when server sends no ratio
      const cur = parseFloat(progressFill.style.width) || 5;
      if (cur < 30) progressFill.style.width = Math.min(30, cur + 1) + '%';
    }, 1500);
    const stopLoadingUI = () => {
      clearInterval(elapsedTimer);
      cancelBtn.style.display = 'none';
      progressTrack.style.display = 'none';
      abortCtrl = null;
    };
    cancelBtn.onclick = () => { if (abortCtrl) abortCtrl.abort(); };

    setGenerateLoading(true);
    resultCard.style.display = 'none';

    try {
      // Revoke previous object URL to prevent memory leak
      if (audioPlayer.src && audioPlayer.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioPlayer.src);
      }
      
      // Build instruct string from form fields
      const formData = new FormData(generateForm);
      const rawValues = {
        text,
        language: formData.get('language') || 'Auto',
        role: formData.get('role') || 'Auto',
        gender: formData.get('gender') || 'Auto',
        accent: formData.get('accent') || 'Auto',
        dialect: formData.get('dialect') || 'Auto',
        speed: formData.get('speed') || '1',
        steps: formData.get('steps') || '32',
        guidance: formData.get('guidance') || '2',
      };
      const parsed = generationSchema
        ? generationSchema.safeParse(rawValues)
        : { success: true, data: rawValues };
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message || 'تحقق من إعدادات التوليد.';
        throw new Error(message);
      }
      const values = parsed.data;
      const roleFull = values.role;
      const genderFull = values.gender;
      const accentFull = values.accent;
      const dialectFull = values.dialect;
      const instructParts = [];
      if (genderFull  !== 'Auto') instructParts.push(genderFull.split(' / ')[0].trim());
      if (roleFull    !== 'Auto') instructParts.push(roleFull.split(' / ')[0].trim());
      if (accentFull  !== 'Auto') instructParts.push(accentFull.split(' / ')[0].trim());
      if (dialectFull !== 'Auto') { const p = dialectFull.split(' / '); instructParts.push((p[1]||p[0]).trim()); }
      const instruct = instructParts.join(', ');

      const refFile = refAudioInput.files[0] || null;
      const refTxt  = document.getElementById('ref_text')?.value || '';
      const speedVal = values.speed;
      const stepsVal = values.steps;
      const guidanceVal = values.guidance;

        // ✅ Generate each chunk then merge into one blob (backend proxy when configured)
      const hasBackend = !!(window.TALKY_CONFIG && window.TALKY_CONFIG.apiBase);
      const blobs = [];
      for (let ci = 0; ci < chunks.length; ci++) {
        if (abortCtrl?.signal.aborted) throw new DOMException("Aborted", "AbortError");
        progressFill.style.width = Math.round((ci / chunks.length) * 90 + 5) + '%';
        const onChunkProgress = (stage, ratio) => {
          const base = (ci / chunks.length) * 90 + 5;
          const span = 90 / chunks.length;
          if (typeof ratio === 'number') setProgress(stage, (base + ratio * span) / 100);
          else setProgress(stage, null);
        };
        let objectUrl;
        if (hasBackend) {
          objectUrl = await generateVoiceViaBackend({
            text: chunks[ci],
            language: values.language, dialect: dialectFull, gender: genderFull, role: roleFull, accent: accentFull,
            refAudio: refFile, refText: refTxt,
            speed: speedVal, steps: stepsVal, guidance: guidanceVal,
            signal: abortCtrl.signal, onProgress: onChunkProgress
          });
        } else {
          objectUrl = await generateVoiceGradio({
            text: chunks[ci], language: values.language,
            refAudio: refFile, refText: refTxt, instruct,
            sp: speedVal, ns: stepsVal, gs: guidanceVal,
            signal: abortCtrl.signal, onProgress: onChunkProgress
          });
        }
        const audioRes = await fetch(objectUrl);
        blobs.push(await audioRes.blob());
        URL.revokeObjectURL(objectUrl);
      }

      const blob = blobs.length === 1 ? blobs[0] : await mergeAudioBlobs(blobs);
      currentAudioBlob = blob;
      const url = URL.createObjectURL(blob);
      audioPlayer.src = url;
      resultCard.style.display = 'block';
      refreshShareVisibility();
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      drawWaveform(blob);
      saveToHistory(text, blob, roleFull);
      showToast('تم التوليد بنجاح!', 'success');
      audioPlayer.play().catch(() => {});

    } catch (err) {
      console.error(err);
      if (err?.name === 'AbortError' || err?.message?.includes('Aborted')) {
        showToast('تم إلغاء التوليد.', 'info');
      } else {
        showToast('خطأ: ' + err.message, 'error');
      }
    } finally {
      stopLoadingUI();
      setGenerateLoading(false);
    }
  });

  function setGenerateLoading(loading) {
    submitBtn.disabled = loading;
    btnText.style.display = loading ? 'none' : 'inline';
    btnLoading.style.display = loading ? 'flex' : 'none';
  }

  /* ================================================================
     7. WAVEFORM VISUALIZER (Canvas)
     ================================================================ */
  async function drawWaveform(blob) {
    const canvas = document.getElementById('waveform-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;

    let audioCtx = null;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const data = audioBuffer.getChannelData(0);
      const step = Math.ceil(data.length / W);
      const amp = H / 2;

      ctx.clearRect(0, 0, W, H);

      // Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, 'rgba(8,66,160,0.1)');
      bgGrad.addColorStop(1, 'rgba(0,0,0,0.05)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Center line
      ctx.beginPath();
      ctx.moveTo(0, amp); ctx.lineTo(W, amp);
      ctx.strokeStyle = 'rgba(168,199,250,0.1)';
      ctx.lineWidth = 1; ctx.stroke();

      // Waveform bars
      const waveGrad = ctx.createLinearGradient(0, 0, 0, H);
      waveGrad.addColorStop(0, '#A8C7FA');
      waveGrad.addColorStop(0.5, '#7DB4F5');
      waveGrad.addColorStop(1, '#A8C7FA');

      ctx.strokeStyle = waveGrad;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      for (let i = 0; i < W; i++) {
        let min = 1.0, max = -1.0;
        for (let j = 0; j < step; j++) {
          const d = data[i * step + j] || 0;
          if (d < min) min = d; if (d > max) max = d;
        }
        const yMin = (1 + min) * amp;
        const yMax = (1 + max) * amp;
        ctx.moveTo(i, yMin);
        ctx.lineTo(i, yMax);
      }
      ctx.stroke();
      audioCtx.close();
    } catch (e) {
      if (audioCtx) audioCtx.close().catch(()=>{});
      // Fallback: draw a placeholder
      const g = ctx.createLinearGradient(0, 0, canvas.offsetWidth, 0);
      g.addColorStop(0, 'rgba(168,199,250,0.3)');
      g.addColorStop(0.5, 'rgba(194,184,255,0.5)');
      g.addColorStop(1, 'rgba(168,199,250,0.3)');
      ctx.fillStyle = g;
      ctx.fillRect(0, canvas.offsetHeight / 2 - 2, canvas.offsetWidth, 4);
    }
  }

  /* ================================================================
     8. SPEED CONTROL
     ================================================================ */
  const speedSlider = document.getElementById('speed-slider');
  const speedDisplay = document.getElementById('speed-display');

  speedSlider.addEventListener('input', () => {
    const val = parseFloat(speedSlider.value).toFixed(1);
    audioPlayer.playbackRate = parseFloat(val);
    audioPlayer.preservesPitch = true;
    speedDisplay.textContent = val + 'x';
  });

  /* ================================================================
     9. AMBIENCE GENERATOR (Web Audio API — no external files)
     ================================================================ */
  const ambienceBtns = document.querySelectorAll('.ambience-btn');

  ambienceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      initAudioContext(); // ✅ FIXED: Initialize AudioContext on user interaction
      ambienceBtns.forEach(b => b.classList.remove('active-ambience'));
      btn.classList.add('active-ambience');
      const type = btn.dataset.ambience;
      stopAmbience();
      if (type !== 'none') startAmbience(type);
    });
  });

  function stopAmbience() {
  if (ambienceSource) {
    try { ambienceSource.stop(); } catch (e) {}
    ambienceSource = null;
  }
  if (ambienceOscillator) {
    try { ambienceOscillator.stop(); } catch (e) {}
    ambienceOscillator = null;
  }
}

  function startAmbience(type) {
    if (!ambienceCtx || ambienceCtx.state === 'closed') {
      ambienceCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ambienceCtx.state === 'suspended') {
      ambienceCtx.resume();
    }
    const gain = ambienceCtx.createGain();
    gain.gain.value = 0.0;
    gain.connect(ambienceCtx.destination);
    ambienceGain = gain;

    const bufferSize = ambienceCtx.sampleRate * 3;
    const noiseBuffer = ambienceCtx.createBuffer(1, bufferSize, ambienceCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    // Fill with white noise
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;

    const source = ambienceCtx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    // Apply filters based on ambience type
    let node = source;

    if (type === 'rain') {
      const hp = ambienceCtx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1800; hp.Q.value = 0.5;
      const lp = ambienceCtx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 8000;
      source.connect(hp); hp.connect(lp); lp.connect(gain);
      gain.gain.value = 0.25;
    } else if (type === 'cafe') {
      const lp = ambienceCtx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 0.3;
      // Add some resonance for crowd feel
      const notch = ambienceCtx.createBiquadFilter();
      notch.type = 'bandpass'; notch.frequency.value = 300; notch.Q.value = 0.5;
      source.connect(lp); lp.connect(notch); notch.connect(gain);
      gain.gain.value = 0.18;
    } else if (type === 'forest') {
      // Nature: mix of filtered noise + subtle oscillator
      const bp = ambienceCtx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 0.4;
      source.connect(bp); bp.connect(gain);
      gain.gain.value = 0.15;

      // Add bird-like oscillator
      const osc = ambienceCtx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = 1200;
      const oscGain = ambienceCtx.createGain(); oscGain.gain.value = 0.02;
      osc.connect(oscGain); oscGain.connect(ambienceCtx.destination);
      osc.start();
      ambienceOscillator = osc; // ✅ FIXED: Store reference to stop later
    } else if (type === 'white') {
      const lp = ambienceCtx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 3000;
      source.connect(lp); lp.connect(gain);
      gain.gain.value = 0.08;
    }

    source.start();
    ambienceSource = source;

    // Fade in
    gain.gain.setValueAtTime(0, ambienceCtx.currentTime);
    gain.gain.linearRampToValueAtTime(
      type === 'white' ? 0.08 : type === 'forest' ? 0.15 : type === 'cafe' ? 0.18 : 0.25,
      ambienceCtx.currentTime + 1.5
    );
  }

  // Download Button
  document.getElementById('download-btn').addEventListener('click', () => {
    if (!currentAudioBlob) return;
    const a = document.createElement('a');
    a.href = audioPlayer.src;
    a.download = 'talky_' + Date.now() + '.wav';
    a.click();
    showToast('جارٍ التحميل...', 'info');
  });

  // Share Button (Web Share API with files — mobile friendly)
  const shareBtn = document.getElementById('share-btn');
  function refreshShareVisibility() {
    if (!shareBtn) return;
    const canShare = !!(navigator.share || navigator.canShare);
    shareBtn.style.display = (currentAudioBlob && canShare) ? '' : 'none';
  }
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      if (!currentAudioBlob) return;
      try {
        const file = new File([currentAudioBlob], 'talky_' + Date.now() + '.wav', { type: 'audio/wav' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Talky Engine', text: 'استمع لما ولّدته بـ Talky' });
        } else if (navigator.share) {
          await navigator.share({ title: 'Talky Engine', text: 'ولّدت صوتاً بـ Talky', url: location.href });
        } else {
          showToast('المشاركة غير مدعومة على هذا المتصفح.', 'error');
        }
      } catch (e) {
        if (e?.name !== 'AbortError') showToast('تعذّرت المشاركة: ' + e.message, 'error');
      }
    });
  }

  /* ================================================================
     10. IndexedDB ARCHIVE (Feature #8)
     ================================================================ */
  function openDB() {
    if (window.TalkyLibs?.Dexie && window.IDBKeyRange) {
      if (!window.__talkyDexieDb) {
        const db = new window.TalkyLibs.Dexie(DB_NAME);
        db.version(1).stores({ [DB_STORE]: '++id,timestamp' });
        window.__talkyDexieDb = db;
      }
      return Promise.resolve(window.__talkyDexieDb);
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          const store = db.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp');
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function saveToHistory(text, blob, role) {
    try {
      const db = await openDB();
      const addOne = () => new Promise((resolve, reject) => {
        if (db.generations) {
          db[DB_STORE].add({ text, blob, role, timestamp: Date.now() })
            .then(resolve).catch(reject);
          return;
        }
        const tx = db.transaction(DB_STORE, 'readwrite');
        const req = tx.objectStore(DB_STORE).add({ text, blob, role, timestamp: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      try {
        await addOne();
      } catch (e) {
        // ✅ Quota guard: evict oldest items then retry once
        if (e?.name === 'QuotaExceededError' || e?.code === 22) {
          const all = await getAllHistory();
          const victims = all.slice(0, Math.max(1, Math.ceil(all.length / 2)));
          for (const v of victims) { try { await deleteHistoryItem(v.id); } catch (_) {} }
          try { await addOne(); } catch (_) {}
          showToast('السجل ممتلئ — تم حذف العناصر الأقدم تلقائياً.', 'info');
          return;
        }
        throw e;
      }

      // Keep only last 15 items (WAV blobs are large)
      const all = await getAllHistory();
      if (all.length > 15) {
        const oldest = all.slice(0, all.length - 15);
        for (const o of oldest) { try { await deleteHistoryItem(o.id); } catch (_) {} }
      }
    } catch (e) { console.warn('History save failed:', e); }
  }

  async function getAllHistory() {
    const db = await openDB();
    if (db.generations) return db[DB_STORE].orderBy('timestamp').toArray();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).index('timestamp').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteHistoryItem(id) {
    const db = await openDB();
    if (db.generations) return db[DB_STORE].delete(id);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const req = tx.objectStore(DB_STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function renderHistory(filterText) {
    const list = document.getElementById('history-list');
    
    list.querySelectorAll('audio').forEach(audio => {
      if (audio.src && audio.src.startsWith('blob:')) {
        URL.revokeObjectURL(audio.src);
      }
    });
    
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">جارٍ التحميل...</div>';
    try {
      let items = await getAllHistory();
      // ✅ Search filter
      if (filterText && filterText.trim()) {
        const q = filterText.trim();
        items = items.filter(it => (it.text || '').includes(q));
      }
      if (items.length === 0) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">${ico('music')}</div>
            <p>لا توجد إنشاءات بعد.</p>
            <p class="empty-sub">ابدأ بتوليد أول مقطع صوتي!</p>
          </div>`;
        return;
      }

      list.innerHTML = '';
      // Show newest first
      [...items].reverse().forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        const dateStr = new Date(item.timestamp).toLocaleDateString('ar-SA', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const url = URL.createObjectURL(item.blob);
        div.innerHTML = `
          <div class="history-meta">
            <span class="history-role-badge">${item.role === 'Auto' ? ico('dice', 'ico-xs') + ' عشوائي' : escapeHTML(item.role.split('/')[0].trim())}</span>
            <span class="history-time">${dateStr}</span>
          </div>
          <div class="history-text">${escapeHTML(item.text)}</div>
          <audio class="history-audio" controls src="${url}"></audio>
          <div class="history-actions">
            <button class="history-dl-btn" data-id="${item.id}" data-url="${url}">${ico('download', 'ico-xs')} تحميل</button>
            <button class="history-del-btn" data-id="${item.id}">${ico('trash', 'ico-xs')} حذف</button>
          </div>`;
        list.appendChild(div);
      });

      // Event delegation
      list.querySelectorAll('.history-dl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const a = document.createElement('a');
          a.href = btn.dataset.url;
          a.download = 'talky_' + btn.dataset.id + '.wav';
          a.click();
        });
      });

      list.querySelectorAll('.history-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await deleteHistoryItem(parseInt(btn.dataset.id));
          showToast('تم الحذف.', 'info');
          renderHistory();
        });
      });

    } catch (e) {
      list.innerHTML = '<div class="empty-state"><p>تعذّر تحميل السجل.</p></div>';
    }
  }

  document.getElementById('clear-history-btn').addEventListener('click', async () => {
    const ok = await openModal({ title: 'مسح السجل', message: 'سيتم حذف جميع الإنشاءات المحفوظة. هل أنت متأكد؟', okText: 'مسح الكل' });
    if (!ok) return;
    const db = await openDB();
    if (db.generations) await db[DB_STORE].clear();
    else {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
    }
    showToast('تم مسح السجل.', 'info');
    const hs = document.getElementById('history-search');
    renderHistory(hs ? hs.value : '');
  });

  // ✅ Live search in history
  const historySearchInput = document.getElementById('history-search');
  if (historySearchInput) {
    historySearchInput.addEventListener('input', debounce(() => {
      renderHistory(historySearchInput.value);
    }, 300));
  }

  /* ================================================================
     11. PODCAST MODE (Feature #3)
     ================================================================ */
  const podcastText = document.getElementById('podcast-text');
  const charAssignments = document.getElementById('character-assignments');
  const podcastGenerateBtn = document.getElementById('podcast-generate-btn');
  const podcastResults = document.getElementById('podcast-results');
  const podcastTracks = document.getElementById('podcast-tracks');
  const playAllBtn = document.getElementById('play-all-btn');

  const ROLE_OPTIONS = [
    { value: 'Auto', label: 'تلقائي' },
    { value: 'News Anchor / 新闻广播', label: 'مذيع أخبار' },
    { value: 'Storyteller / 故事讲述', label: 'راوي قصص' },
    { value: 'Voice Assistant / 语音助手', label: 'مساعد صوتي' },
    { value: 'Lecturer / 讲师', label: 'محاضر' },
    { value: 'Customer Service / 客户服务', label: 'خدمة عملاء' },
  ];

  const GENDER_OPTIONS = [
    { value: 'Auto', label: 'تلقائي' },
    { value: 'Male', label: 'ذكر' },
    { value: 'Female', label: 'أنثى' },
  ];

  // Parse dialogue & show character assignments
  podcastText.addEventListener('input', debounce(parsePodcastText, 600));

  function parsePodcastText() {
    const lines = podcastText.value.split('\n').filter(l => l.trim());
    const chars = new Map();
    lines.forEach(line => {
      const m = line.match(/^(.+?)[:：]\s*(.+)/);
      if (m) {
        const name = m[1].trim();
        if (!chars.has(name)) chars.set(name, { role: 'Auto', gender: 'Auto' });
      }
    });

    if (chars.size === 0) { charAssignments.innerHTML = ''; return; }

    charAssignments.innerHTML = `<div style="margin:14px 0 8px;font-size:13px;font-weight:700;color:var(--text-secondary);">${ico('wave', 'ico-xs')} شخصيات الحوار</div>`;
    chars.forEach((_, name) => {
      const div = document.createElement('div');
      div.className = 'character-assignment';
      div.dataset.char = name;
      div.innerHTML = `
        <span class="character-name-badge">${escapeHTML(name)}</span>
        <select class="char-role-select" data-char="${escapeHTML(name)}">
          ${ROLE_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
        </select>
        <select class="char-gender-select" data-char="${escapeHTML(name)}">
          ${GENDER_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
        </select>`;
      charAssignments.appendChild(div);
    });
  }

  podcastGenerateBtn.addEventListener('click', async () => {
    const text = podcastText.value.trim();
    if (!text) { showToast('الرجاء إدخال نص الحوار.', 'error'); return; }

    const lines = text.split('\n').map(l => {
      const m = l.match(/^(.+?)[:：]\s*(.+)/);
      return m ? { char: m[1].trim(), text: m[2].trim() } : null;
    }).filter(Boolean);

    if (lines.length === 0) {
      showToast('لم أتمكن من قراءة الحوار. تأكد من صيغة "الاسم: النص"', 'error');
      return;
    }

    // Collect character settings
    const charSettings = {};
    document.querySelectorAll('.character-assignment').forEach(el => {
      const name = el.dataset.char;
      charSettings[name] = {
        role: el.querySelector('.char-role-select').value,
        gender: el.querySelector('.char-gender-select').value,
      };
    });

    // Show loading
    const podcastBtnText = podcastGenerateBtn.querySelector('.podcast-btn-text');
    const podcastLoading = podcastGenerateBtn.querySelector('.podcast-loading');
    const podcastProgress = document.getElementById('podcast-progress');
    podcastBtnText.style.display = 'none';
    podcastLoading.style.display = 'flex';
    podcastGenerateBtn.disabled = true;

    if (podcastBlobs.length > 0) {
      podcastBlobs.forEach(b => URL.revokeObjectURL(b.url));
    }
    podcastBlobs = [];
    podcastTracks.innerHTML = '';
    podcastResults.style.display = 'none';

    for (let i = 0; i < lines.length; i++) {
      const { char, text: lineText } = lines[i];
      podcastProgress.textContent = `(${i + 1}/${lines.length})`;

      // Build instruct from character settings
      const cs = charSettings[char] || {};
      const instParts = [];
      if (cs.gender && cs.gender !== 'Auto') instParts.push(cs.gender.split(' / ')[0].trim());
      if (cs.role   && cs.role   !== 'Auto') instParts.push(cs.role.split(' / ')[0].trim());
      
      try {
        // ✅ Backend proxy when configured, otherwise direct OmniVoice (1 retry)
        const hasBackendPod = !!(window.TALKY_CONFIG && window.TALKY_CONFIG.apiBase);
        let objUrl = null, lastErr = null;
        for (let attempt = 1; attempt <= 2 && !objUrl; attempt++) {
          try {
            if (hasBackendPod) {
              const cs2 = charSettings[char] || {};
              objUrl = await generateVoiceViaBackend({
                text: lineText, language: 'Auto',
                dialect: 'Auto', gender: cs2.gender || 'Auto', role: cs2.role || 'Auto', accent: 'Auto',
                instruct: instParts.join(', ')
              });
            } else {
              objUrl = await generateVoiceGradio({
                text: lineText, language: 'Auto', instruct: instParts.join(', ')
              });
            }
          } catch (e) { lastErr = e; if (attempt === 1) await new Promise(r => setTimeout(r, 1500)); }
        }
        if (!objUrl) throw lastErr || new Error('فشل التوليد');
        const bRes = await fetch(objUrl);
        const blob = await bRes.blob();
        const url  = URL.createObjectURL(blob);
        podcastBlobs.push({ char, text: lineText, blob, url });

        const track = document.createElement('div');
        track.className = 'podcast-track';
        track.innerHTML = `
          <span class="track-char">${escapeHTML(char)}</span>
          <span class="track-text">${escapeHTML(lineText)}</span>
          <div class="track-info">
            <span class="track-status done">${ico('check', 'ico-xs')} جاهز</span>
            <audio class="track-audio" controls src="${url}"></audio>
          </div>`;
        podcastTracks.appendChild(track);
      } catch (err) {
        const errDiv = document.createElement('div');
        errDiv.className = 'podcast-track';
        errDiv.innerHTML = `
          <span class="track-char">${escapeHTML(char)}</span>
          <span class="track-text">${escapeHTML(lineText)}</span>
          <div class="track-info">
            <span class="track-status" style="color:var(--error);">${ico('x', 'ico-xs')} فشل</span>
          </div>`;
        podcastTracks.appendChild(errDiv);
      }
    }

    podcastResults.style.display = 'block';
    podcastBtnText.style.display = 'inline';
    podcastLoading.style.display = 'none';
    podcastGenerateBtn.disabled = false;
    showToast(`اكتمل البودكاست! (${podcastBlobs.length}/${lines.length} مقطع)`, 'success');
    podcastResults.scrollIntoView({ behavior: 'smooth' });
  });

  // Play All (sequential) with overlap prevention
  let isPlayingAll = false;
  let activePodcastAudio = null;

  playAllBtn.addEventListener('click', async () => {
    if (podcastBlobs.length === 0) return;
    
    // Toggle stop if already playing
    if (isPlayingAll) {
      isPlayingAll = false;
      if (activePodcastAudio) activePodcastAudio.pause();
      playAllBtn.innerHTML = ico('play', 'ico-sm') + ' تشغيل الكل بالترتيب';
      return;
    }

    isPlayingAll = true;
    playAllBtn.innerHTML = ico('stop', 'ico-sm') + ' إيقاف تشغيل الكل';
    
    try {
      for (const item of podcastBlobs) {
        if (!isPlayingAll) break;
        await playBlob(item.blob);
      }
    } finally {
      isPlayingAll = false;
      playAllBtn.innerHTML = ico('play', 'ico-sm') + ' تشغيل الكل بالترتيب';
      activePodcastAudio = null;
    }
  });

  function playBlob(blob) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activePodcastAudio = audio; // Track the playing instance
      const cleanup = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      audio.play().catch(cleanup);
    });
  }

  // ✅ Merge all podcast tracks into one WAV and download
  const mergePodcastBtn = document.getElementById('merge-podcast-btn');
  if (mergePodcastBtn) {
    mergePodcastBtn.addEventListener('click', async () => {
      if (podcastBlobs.length === 0) { showToast('لا توجد مقاطع للدمج.', 'error'); return; }
      mergePodcastBtn.disabled = true;
      mergePodcastBtn.textContent = '⏳ جارٍ الدمج...';
      try {
        const merged = await mergeAudioBlobs(podcastBlobs.map(p => p.blob));
        const url = URL.createObjectURL(merged);
        const a = document.createElement('a');
        a.href = url; a.download = 'talky_podcast_merged.wav'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast('تم دمج وتحميل البودكاست!', 'success');
      } catch (e) {
        showToast('فشل الدمج: ' + e.message, 'error');
      } finally {
        mergePodcastBtn.disabled = false;
        mergePodcastBtn.innerHTML = ico('download', 'ico-sm') + ' دمج وتحميل الكل (WAV)';
      }
    });
  }

  /* ================================================================
     12. TOAST NOTIFICATIONS (+ custom modal)
     ================================================================ */
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  /* Accessible modal replacing blocking confirm()/prompt() */
  function openModal({ title = 'تأكيد', message = '', input = false, defaultValue = '', okText = 'تأكيد' } = {}) {
    return new Promise(resolve => {
      const overlay = document.getElementById('modal-overlay');
      const titleEl = document.getElementById('modal-title');
      const msgEl = document.getElementById('modal-msg');
      const wrapEl = document.getElementById('modal-input-wrap');
      const inputEl = document.getElementById('modal-input');
      const okBtn = document.getElementById('modal-ok');
      const cancelBtn = document.getElementById('modal-cancel');
      titleEl.textContent = title;
      msgEl.textContent = message;
      msgEl.style.display = message ? '' : 'none';
      wrapEl.style.display = input ? '' : 'none';
      inputEl.value = defaultValue || '';
      okBtn.textContent = okText;
      overlay.style.display = 'flex';
      const cleanup = (val) => {
        overlay.style.display = 'none';
        okBtn.onclick = cancelBtn.onclick = overlay.onclick = null;
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onKey = (e) => { if (e.key === 'Escape') cleanup(input ? null : false); };
      okBtn.onclick = () => cleanup(input ? inputEl.value : true);
      cancelBtn.onclick = () => cleanup(input ? null : false);
      overlay.onclick = (e) => { if (e.target === overlay) cleanup(input ? null : false); };
      document.addEventListener('keydown', onKey);
      setTimeout(() => { (input ? inputEl : okBtn).focus(); }, 50);
    });
  }

  /* ================================================================
     UTILITIES
     ================================================================ */
  function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Inline SVG icon from the sprite. Usage: ico('mic')  /  ico('trash','ico-sm')
  function ico(name, cls) {
    return '<svg class="ico ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /* ================================================================
      0c. BACKEND BADGE
      ================================================================ */
  (function initBackendBadge() {
    const el = document.getElementById('backend-badge');
    if (!el) return;
    const cfg = window.TALKY_CONFIG || {};
    if (cfg.apiBase) {
      el.textContent = '✓ الباكند متصل — الحصة محمية';
      el.style.display = 'block';
      el.style.color = 'var(--success)';
    } else {
      el.textContent = 'وضع مباشر — قد تنفد الحصة سريعاً';
      el.style.display = 'block';
      el.style.color = 'var(--text-secondary)';
    }
  })();

  /* ================================================================
      INIT
      ================================================================ */
  // Ensure correct initial tab display
  document.querySelectorAll('.tab-content').forEach((el, i) => {
    if (i !== 0) el.style.display = 'none';
  });

})();
