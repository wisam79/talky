'use strict';
/**
 * app.js UI tests on a real DOM (jsdom + stubbed browser APIs).
 *
 * Two wire formats are used by the OmniVoice stream:
 *   • REAL    → event: complete / data: [audio, status]  (spec)
 *   • LEGACY  → onmessage {msg:'process_completed', output:{data:[…]}} (plumbing)
 * UI-plumbing tests drive the LEGACY shape so they can pass today; the SPEC
 * test drives the REAL shape and stays red until gradio_api.js is fixed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, jsonResponse } = require('./helpers/dom_env');
const { FakeEventSource } = require('./helpers/fake_event_source');

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const $ = (id, doc) => doc.getElementById(id);
const finish = (t, env) => t.after(() => { env.clearTimers(); env.dom.window.close(); });

function submitGeneration(env) {
  env.document.getElementById('submit-btn').dispatchEvent(
    new env.window.Event('submit', { bubbles: true, cancelable: true }));
}

function prepareGenerateEnv(overrides = {}) {
  const env = loadApp();
  env.fetchHandler = (url) => {
    if (String(url).includes('/gradio_api/call/_clone_fn')) {
      return jsonResponse({ event_id: 'evt-1' });
    }
    return jsonResponse({}); // audio blob download
  };
  Object.assign(env, overrides);
  return env;
}

/** Drive the completion in the format real Gradio sends. */
function emitReal(es, url) {
  es.emit('complete', [{ url }, 'ok']);
}

/** Drive the completion the current gradio_api.js expects (legacy). */
function emitLegacy(es, url) {
  // The code now only handles the REAL wire format (named "complete" event).
  emitReal(es, url);
}

// ─────────────────────────────── theme ───────────────────────────────

test('theme: defaults to dark, toggles to light and persists', t => {
  const env = loadApp();
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'dark');
  $('theme-toggle', env.document).click();
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(env.window.localStorage.getItem('talky_theme'), 'light');
  finish(t, env);
});

test('theme: restores saved preference on load', t => {
  const env = loadApp({ seedTheme: 'light' });
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'light');
  finish(t, env);
});

// ─────────────────────────────── tabs ───────────────────────────────

test('tabs: switching shows the target panel and hides others', t => {
  const env = loadApp();
  const podcast = $('tab-podcast', env.document);
  const generator = $('tab-generator', env.document);
  assert.notEqual(generator.style.display, 'none');
  assert.equal(podcast.style.display, 'none');
  env.document.querySelector('[data-tab="podcast"]').click();
  assert.equal(podcast.style.display, 'flex');
  assert.equal(generator.style.display, 'none');
  assert.equal(
    env.document.querySelector('[data-tab="podcast"]').getAttribute('aria-selected'), 'true');
  finish(t, env);
});

// ───────────────────────── word counter ─────────────────────────

test('word counter: counts words and estimates duration', t => {
  const env = loadApp();
  const text = $('text', env.document);
  text.value = 'واحد اثنان ثلاثة';
  text.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  assert.equal($('word-count', env.document).textContent, '3 كلمة');
  assert.equal($('duration-estimate', env.document).textContent, '~ 2 ث');
  text.value = new Array(60).fill('كلمة').join(' '); // 60 words → 30s
  text.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  assert.equal($('duration-estimate', env.document).textContent, '~ 30 ث');
  finish(t, env);
});

// ───────────────────────── presets ─────────────────────────

test('presets: clicking a preset fills hidden role/gender inputs', t => {
  const env = loadApp();
  env.document.getElementById('preset-anchor').click();
  assert.equal($('role', env.document).value, 'News Anchor / 新闻广播');
  assert.equal($('gender', env.document).value, 'Male');
  assert.ok(env.document.getElementById('preset-anchor').classList.contains('active'));
  finish(t, env);
});

// ───────────────────────── favorites ─────────────────────────

test('favorites: save, list, role/gender apply, and delete', async t => {
  const env = loadApp();
  env.document.getElementById('preset-story').click();
  env.document.getElementById('save-fav-btn').click();
  const modal = $('modal-overlay', env.document);
  assert.equal(modal.style.display, 'flex');
  $('modal-input', env.document).value = 'اختباري';
  $('modal-ok', env.document).click();
  await tick();

  const favs = JSON.parse(env.window.localStorage.getItem('talky_favs'));
  assert.equal(favs.length, 1);

  const favBtn = env.document.querySelector('#fav-list .fav-btn');
  assert.ok(favBtn, 'favorite button not rendered');
  favBtn.click();
  await tick();
  assert.equal($('role', env.document).value, 'Storyteller / 故事讲述');
  assert.equal($('gender', env.document).value, 'Female');

  favBtn.dispatchEvent(new env.window.MouseEvent('contextmenu', { bubbles: true }));
  await tick();
  $('modal-ok', env.document).click();
  await tick();
  assert.equal(JSON.parse(env.window.localStorage.getItem('talky_favs')).length, 0);
  finish(t, env);
});

test('SPEC: favorites restore dialect and accent (currently red)', async t => {
  const env = loadApp();
  env.document.getElementById('preset-story').click();
  const dialect = $('dialect', env.document);
  dialect.value = 'Gulf';
  const accent = $('accent', env.document);
  accent.value = 'British Accent / 英国口音';
  env.document.getElementById('save-fav-btn').click();
  await tick();
  $('modal-input', env.document).value = 'كامل';
  $('modal-ok', env.document).click();
  await tick();

  // change away, then apply the favorite again
  dialect.value = 'Auto';
  accent.value = 'Auto';
  env.document.querySelector('#fav-list .fav-btn').click();
  await tick();
  assert.equal(dialect.value, 'Gulf', 'dialect not restored by favorite');
  assert.equal(accent.value, 'British Accent / 英国口音', 'accent not restored by favorite');
  finish(t, env);
});

// ───────────────────────── doc import ─────────────────────────

test('doc import: reads a txt file, strips markdown and badges the name', async t => {
  const env = loadApp();
  const input = $('doc-upload', env.document);
  const file = new env.window.File(['# عنوان\n\nمحمى *النص* هنا'], 'story.txt',
                                   { type: 'text/plain' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new env.window.Event('change', { bubbles: true }));
  await tick(30);
  assert.match($('text', env.document).value, /محمى/);
  assert.ok(!$('text', env.document).value.includes('#'), 'markdown not stripped');
  assert.notEqual($('doc-name-badge', env.document).style.display, 'none');
  assert.ok($('doc-name-badge', env.document).textContent.includes('story.txt'));
  finish(t, env);
});

test('doc import: rejects oversized files', async t => {
  const env = loadApp();
  const input = $('doc-upload', env.document);
  const big = new env.window.File([new Uint8Array(201 * 1024)], 'big.txt',
                                  { type: 'text/plain' });
  Object.defineProperty(input, 'files', { value: [big], configurable: true });
  input.dispatchEvent(new env.window.Event('change', { bubbles: true }));
  await tick(30);
  assert.equal($('text', env.document).value, '');
  finish(t, env);
});

// ───────────────────────── generation flow ─────────────────────────

test('generation: empty text shows a toast and skips the API', async t => {
  const env = prepareGenerateEnv();
  submitGeneration(env);
  await tick();
  assert.equal(env.fetchCalls.length, 0);
  const toast = env.document.querySelector('#toast-container .toast');
  assert.ok(toast, 'no toast shown');
  finish(t, env);
});

test('generation: happy path updates progress, result card and history (legacy SSE)', async t => {
  const env = prepareGenerateEnv();
  $('text', env.document).value = 'مرحبا بالعالم';
  submitGeneration(env);
  await tick(30);
  const es = FakeEventSource.last();
  assert.ok(es, 'no EventSource opened');
  assert.equal($('cancel-btn', env.document).style.display, 'block');
  emitLegacy(es, 'https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/o.wav');
  await tick(50);

  assert.equal($('result-card', env.document).style.display, 'block');
  assert.match($('audio-player', env.document).getAttribute('src') || '', /^blob:/);
  assert.ok(env.idb.store.records.size >= 1, 'history not saved');
  assert.equal($('cancel-btn', env.document).style.display, 'none');
  const toast = env.document.querySelector('#toast-container .toast.success');
  assert.ok(toast, 'no success toast');
  finish(t, env);
});

test('generation: submit error toasts and restores the button', async t => {
  const env = loadApp();
  env.fetchHandler = () => ({ ok: false, status: 500, statusText: 'x',
                              text: async () => 'server down' });
  $('text', env.document).value = 'مرحبا';
  submitGeneration(env);
  await tick(40);
  const err = env.document.querySelector('#toast-container .toast.error');
  assert.ok(err && err.textContent.includes('server down'), 'no error toast');
  assert.equal($('submit-btn', env.document).disabled, false);
  finish(t, env);
});

test('generation: cancel button aborts and toasts', async t => {
  const env = prepareGenerateEnv();
  $('text', env.document).value = 'مرحبا';
  submitGeneration(env);
  await tick(30);
  $('cancel-btn', env.document).click();
  await tick(30);
  const toasts = [...env.document.querySelectorAll('#toast-container .toast')];
  assert.ok(toasts.some(x => x.textContent.includes('إلغاء')), 'no cancel toast');
  assert.equal($('cancel-btn', env.document).style.display, 'none');
  finish(t, env);
});

test('SPEC: generation succeeds with the REAL OmniVoice SSE frame', async t => {
  const env = prepareGenerateEnv();
  $('text', env.document).value = 'مرحبا';
  submitGeneration(env);
  await tick(30);
  emitReal(FakeEventSource.last(),
           'https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/o.wav');
  await tick(50);
  assert.equal($('result-card', env.document).style.display, 'block');
  finish(t, env);
});

test('generation: long text is split into chunks and merged', async t => {
  const env = prepareGenerateEnv();
  finish(t, env); // register cleanup FIRST so pending timers are always cleared
  $('text', env.document).value = 'جملة أولى طويلة. '.repeat(200); // >1200 chars
  submitGeneration(env);
  await tick(30);
  assert.ok(FakeEventSource.instances.length >= 1);
  // Chunks are generated sequentially — complete each new stream as it opens.
  let guard = 0;
  while (guard++ < 12) {
    const es = FakeEventSource.last();
    if (!es) break;
    emitLegacy(es,
               `https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/c${guard}.wav`);
    await tick(40);
    if ($('result-card', env.document).style.display === 'block') break;
  }
  assert.equal($('result-card', env.document).style.display, 'block');
  assert.ok(env.idb.store.records.size >= 1);
});

// ───────────────────────── history ─────────────────────────

test('history: list, search, delete and clear', async t => {
  const env = prepareGenerateEnv();
  $('text', env.document).value = 'أول نص';
  submitGeneration(env);
  await tick(30);
  emitLegacy(FakeEventSource.last(),
             'https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/a.wav');
  await tick(40);

  $('text', env.document).value = 'ثاني نص';
  submitGeneration(env);
  await tick(30);
  emitLegacy(FakeEventSource.last(),
             'https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/b.wav');
  await tick(40);

  env.document.querySelector('[data-tab="history"]').click();
  await tick(30);
  let items = env.document.querySelectorAll('.history-item');
  assert.equal(items.length, 2);

  // search
  const search = $('history-search', env.document);
  search.value = 'أول';
  search.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  await tick(450);
  items = env.document.querySelectorAll('.history-item');
  assert.equal(items.length, 1);
  assert.ok(items[0].textContent.includes('أول نص'));

  // clear the filter, then delete the remaining item
  search.value = '';
  search.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  await tick(450);
  assert.equal(env.document.querySelectorAll('.history-item').length, 2);
  env.document.querySelector('.history-del-btn').click();
  await tick(40);
  assert.equal(env.document.querySelectorAll('.history-item').length, 1);

  // clear all
  $('clear-history-btn', env.document).click();
  await tick(10);
  $('modal-ok', env.document).click();
  await tick(40);
  assert.equal(env.document.querySelectorAll('.history-item').length, 0);
  assert.equal(env.idb.store.records.size, 0);
  finish(t, env);
});

test('history: keeps at most 15 items', async t => {
  const env = prepareGenerateEnv();
  for (let i = 0; i < 20; i++) {
    env.idb.store.add({ text: `نص ${i}`, blob: new env.window.Blob([i]),
                        role: 'Auto', timestamp: i });
  }
  $('text', env.document).value = 'جديد';
  submitGeneration(env);
  await tick(30);
  emitLegacy(FakeEventSource.last(),
             'https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/x.wav');
  await tick(40);
  assert.equal(env.idb.store.records.size, 15);
  finish(t, env);
});

test('history: quota exceeded evicts oldest half and keeps working', async t => {
  const env = prepareGenerateEnv();
  for (let i = 0; i < 10; i++) {
    env.idb.store.add({ text: `نص ${i}`, blob: new env.window.Blob([i]),
                        role: 'Auto', timestamp: i });
  }
  env.idb.store.failNextAddWith = Object.assign(new Error('quota'),
                                                { name: 'QuotaExceededError', code: 22 });
  $('text', env.document).value = 'جديد';
  submitGeneration(env);
  await tick(30);
  emitLegacy(FakeEventSource.last(),
             'https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/x.wav');
  await tick(50);
  assert.equal(env.idb.store.records.size, 6); // 10 → evict 5 → +1
  finish(t, env);
});

// ───────────────────────── podcast ─────────────────────────

test('podcast: parses dialogue and escapes character names', async t => {
  const env = loadApp();
  const ta = $('podcast-text', env.document);
  ta.value = '<b>أحمد</b>: مرحبا\nسارة: أهلاً';
  ta.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  await tick(700);
  const assignments = env.document.querySelectorAll('.character-assignment');
  assert.equal(assignments.length, 2);
  assert.ok(assignments[0].innerHTML.includes('&lt;b&gt;'), 'name not escaped');
  finish(t, env);
});

test('podcast: generates one track per line and merges into WAV', async t => {
  const env = prepareGenerateEnv();
  $('podcast-text', env.document).value = 'أحمد: مرحبا بكم\nسارة: معنا ضيف';
  $('podcast-text', env.document).dispatchEvent(
    new env.window.Event('input', { bubbles: true }));
  await tick(700);

  $('podcast-generate-btn', env.document).click();
  await tick(30);
  assert.equal(FakeEventSource.instances.length, 1);
  emitLegacy(FakeEventSource.last(),
             'https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/p1.wav');
  await tick(30);
  assert.equal(FakeEventSource.instances.length, 2, 'second line never generated');
  emitLegacy(FakeEventSource.last(),
             'https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/p2.wav');
  await tick(50);

  const tracks = env.document.querySelectorAll('.podcast-track');
  assert.equal(tracks.length, 2);
  assert.ok(tracks[0].querySelector('.track-audio'), 'track audio missing');
  assert.equal($('podcast-results', env.document).style.display, 'block');

  $('merge-podcast-btn', env.document).click();
  await tick(50);
  const toasts = [...env.document.querySelectorAll('#toast-container .toast')];
  assert.ok(toasts.some(x => x.textContent.includes('دمج')), 'no merge toast');
  assert.equal($('merge-podcast-btn', env.document).disabled, false);
  finish(t, env);
});

// ───────────────────────── misc UX ─────────────────────────

test('share button stays hidden without a Web Share API', t => {
  const env = loadApp();
  assert.equal(env.window.navigator.share, undefined);
  $('share-btn', env.document).click(); // must not throw
  assert.equal($('share-btn', env.document).style.display, 'none');
  finish(t, env);
});

test('recording without microphone permission toasts an error', async t => {
  const env = loadApp();
  delete env.window.navigator.mediaDevices;
  $('record-btn', env.document).click();
  await tick(20);
  const toast = env.document.querySelector('#toast-container .toast.error');
  assert.ok(toast && toast.textContent.includes('المايكروفون'));
  finish(t, env);
});

test('advanced options toggle opens and closes', t => {
  const env = loadApp();
  const content = $('advanced-content', env.document);
  assert.equal(content.style.display, 'none');
  $('advanced-toggle', env.document).click();
  assert.equal(content.style.display, 'block');
  assert.equal($('advanced-toggle', env.document).getAttribute('aria-expanded'), 'true');
  $('advanced-toggle', env.document).click();
  assert.equal(content.style.display, 'none');
  finish(t, env);
});
