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
  let podcastQueue = [];  // for play-all
  const DB_NAME = 'talky_history';
  const DB_STORE = 'generations';

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

  textArea.addEventListener('input', updateWordCount);

  function updateWordCount() {
    const words = textArea.value.trim().split(/\s+/).filter(Boolean);
    const count = words.length;
    wordCountEl.textContent = count + ' كلمة';
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
      const roleAdv = document.getElementById('role-adv');
      const genderAdv = document.getElementById('gender-adv');
      if (roleAdv) roleAdv.value = btn.dataset.role;
      if (genderAdv) genderAdv.value = btn.dataset.gender;
    });
  });

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

      showToast('بدأ التسجيل. اضغط "⏹ إيقاف" عند الانتهاء.', 'info');
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
    recordBtnText.textContent = '🎤 تسجيل';
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

    showFileBadge('🎤 صوت مسجّل (' + recordSeconds + ' ث)');
    refTextGroup.style.display = 'block';
    showToast('تم حفظ التسجيل كصوت مرجعي!', 'success');
  }

  function updateRecTimer() {
    const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
    const s = String(recordSeconds % 60).padStart(2, '0');
    recTimerEl.textContent = `${m}:${s}`;
  }

  // File Upload
  refAudioInput.addEventListener('change', () => {
    if (refAudioInput.files.length > 0) {
      showFileBadge('📁 ' + refAudioInput.files[0].name);
      refTextGroup.style.display = 'block';
    } else {
      fileNameBadge.style.display = 'none';
      refTextGroup.style.display = 'none';
    }
  });

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
      showFileBadge('📁 ' + e.dataTransfer.files[0].name);
      refTextGroup.style.display = 'block';
    }
  });

  function showFileBadge(text) {
    fileNameBadge.textContent = text;
    fileNameBadge.style.display = 'inline-flex';
  }

  /* ================================================================
     5. ADVANCED OPTIONS TOGGLE
     ================================================================ */
  const advancedToggle = document.getElementById('advanced-toggle');
  const advancedContent = document.getElementById('advanced-content');
  const toggleChevron = document.getElementById('toggle-chevron');

  advancedToggle.addEventListener('click', () => {
    const isOpen = advancedContent.style.display !== 'none';
    advancedContent.style.display = isOpen ? 'none' : 'block';
    toggleChevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    advancedToggle.setAttribute('aria-expanded', !isOpen);
  });

  // Random Seed
  document.getElementById('random-seed-btn').addEventListener('click', () => {
    document.getElementById('seed-input').value = Math.floor(Math.random() * 10000);
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

    setGenerateLoading(true);
    resultCard.style.display = 'none';

    try {
      // Revoke previous object URL to prevent memory leak
      if (audioPlayer.src && audioPlayer.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioPlayer.src);
      }
      
      const formData = new FormData(generateForm);
      const response = await fetch('/api/generate', { method: 'POST', body: formData });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(err.detail || 'فشل الطلب');
      }

      const blob = await response.blob();
      currentAudioBlob = blob;
      const url = URL.createObjectURL(blob);
      audioPlayer.src = url;
      resultCard.style.display = 'block';
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

      drawWaveform(blob);
      saveToHistory(text, blob, roleInput.value);

      showToast('تم التوليد بنجاح! 🎉', 'success');
      audioPlayer.play().catch(() => {});

    } catch (err) {
      console.error(err);
      showToast('خطأ: ' + err.message, 'error');
    } finally {
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
  if (ambienceCtx) {
    ambienceCtx.close().catch(() => {});
    ambienceCtx = null;
  }
}

  function startAmbience(type) {
    ambienceCtx = new (window.AudioContext || window.webkitAudioContext)();
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
    a.href = URL.createObjectURL(currentAudioBlob);
    a.download = 'talky_' + Date.now() + '.wav';
    a.click();
    showToast('جارٍ التحميل...', 'info');
  });

  /* ================================================================
     10. IndexedDB ARCHIVE (Feature #8)
     ================================================================ */
  function openDB() {
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
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).add({ text, blob, role, timestamp: Date.now() });

      // Keep only last 20 items
      const all = await getAllHistory();
      if (all.length > 20) {
        const oldest = all[0];
        const delTx = db.transaction(DB_STORE, 'readwrite');
        delTx.objectStore(DB_STORE).delete(oldest.id);
      }
    } catch (e) { console.warn('History save failed:', e); }
  }

  async function getAllHistory() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).index('timestamp').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteHistoryItem(id) {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
  }

  async function renderHistory() {
    const list = document.getElementById('history-list');
    
    list.querySelectorAll('audio').forEach(audio => {
      if (audio.src && audio.src.startsWith('blob:')) {
        URL.revokeObjectURL(audio.src);
      }
    });
    
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">جارٍ التحميل...</div>';
    try {
      const items = await getAllHistory();
      if (items.length === 0) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🎵</div>
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
            <span class="history-role-badge">${item.role === 'Auto' ? '🎲 عشوائي' : item.role.split('/')[0].trim()}</span>
            <span class="history-time">${dateStr}</span>
          </div>
          <div class="history-text">${escapeHTML(item.text)}</div>
          <audio class="history-audio" controls src="${url}"></audio>
          <div class="history-actions">
            <button class="history-dl-btn" data-id="${item.id}" data-url="${url}">⬇️ تحميل</button>
            <button class="history-del-btn" data-id="${item.id}">🗑️ حذف</button>
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
    if (!confirm('سيتم حذف جميع الإنشاءات المحفوظة. هل أنت متأكد؟')) return;
    const db = await openDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    showToast('تم مسح السجل.', 'info');
    renderHistory();
  });

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

    charAssignments.innerHTML = `<div style="margin:14px 0 8px;font-size:13px;font-weight:700;color:var(--text-secondary);">🎭 شخصيات الحوار</div>`;
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

      const fd = new FormData();
      fd.append('text', lineText);
      fd.append('language', 'Auto');
      fd.append('role', charSettings[char]?.role || 'Auto');
      fd.append('gender', charSettings[char]?.gender || 'Auto');
      fd.append('dialect', 'Auto');
      fd.append('accent', 'Auto');
      fd.append('ref_text', '');
      fd.append('seed', 0);

      try {
        const res = await fetch('/api/generate', { method: 'POST', body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || 'فشل الطلب');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        podcastBlobs.push({ char, text: lineText, blob, url });

        const track = document.createElement('div');
        track.className = 'podcast-track';
        track.innerHTML = `
          <span class="track-char">${escapeHTML(char)}</span>
          <span class="track-text">${escapeHTML(lineText)}</span>
          <div class="track-info">
            <span class="track-status done">✅ جاهز</span>
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
            <span class="track-status" style="color:var(--error);">❌ فشل</span>
          </div>`;
        podcastTracks.appendChild(errDiv);
      }
    }

    podcastResults.style.display = 'block';
    podcastBtnText.style.display = 'inline';
    podcastLoading.style.display = 'none';
    podcastGenerateBtn.disabled = false;
    showToast(`✅ اكتمل البودكاست! (${podcastBlobs.length}/${lines.length} مقطع)`, 'success');
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
      playAllBtn.innerHTML = '▶️ تشغيل الكل بالترتيب';
      return;
    }

    isPlayingAll = true;
    playAllBtn.textContent = '⏹ إيقاف تشغيل الكل';
    
    try {
      for (const item of podcastBlobs) {
        if (!isPlayingAll) break;
        await playBlob(item.blob);
      }
    } finally {
      isPlayingAll = false;
      playAllBtn.innerHTML = '▶️ تشغيل الكل بالترتيب';
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

  /* ================================================================
     12. TOAST NOTIFICATIONS
     ================================================================ */
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  /* ================================================================
     UTILITIES
     ================================================================ */
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /* ================================================================
     INIT
     ================================================================ */
  // Ensure correct initial tab display
  document.querySelectorAll('.tab-content').forEach((el, i) => {
    if (i !== 0) el.style.display = 'none';
  });

})();
