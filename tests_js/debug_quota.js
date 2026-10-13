'use strict';
// Standalone trace of the quota-eviction path.
const { loadApp } = require('./tests_js/helpers/dom_env');
const { FakeEventSource } = require('./tests_js/helpers/fake_event_source');

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const $ = (id, doc) => doc.getElementById(id);

(async () => {
  const env = loadApp();
  env.fetchHandler = (url) => {
    if (String(url).includes('/gradio_api/call/_clone_fn')) {
      return { ok: true, status: 200, statusText: 'OK',
               json: async () => ({ event_id: 'evt-1' }),
               text: async () => '{}' };
    }
    return { ok: true, status: 200, statusText: 'OK',
             json: async () => ({}), text: async () => '{}' };
  };
  for (let i = 0; i < 10; i++) {
    env.idb.store.add({ text: `نص ${i}`, blob: new env.window.Blob([i]),
                        role: 'Auto', timestamp: i });
  }
  console.log('seeded:', env.idb.store.records.size);
  env.idb.store.failNextAddWith = Object.assign(new Error('quota'),
                                                { name: 'QuotaExceededError', code: 22 });
  $('text', env.document).value = 'جديد';
  submitGeneration(env);
  await tick(30);
  const es = FakeEventSource.last();
  console.log('event source opened:', !!es);
  if (es) es.emit('complete', [{ url: 'https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/x.wav' }, 'ok']);
  await tick(80);
  console.log('final records:', env.idb.store.records.size);
  console.log('record ids:', [...env.idb.store.records.keys()]);
  const toasts = [...env.document.querySelectorAll('#toast-container .toast')];
  console.log('toasts:', toasts.map(t => t.textContent));
  console.log('result-card:', $('result-card', env.document).style.display);
  env.clearTimers();
  env.dom.window.close();
  process.exit(0);
})().catch(e => { console.error('TRACE FAIL', e); process.exit(1); });

function submitGeneration(env) {
  env.document.getElementById('submit-btn').dispatchEvent(
    new env.window.Event('submit', { bubbles: true, cancelable: true }));
}
