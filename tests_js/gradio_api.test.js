'use strict';
/**
 * gradio_api.js contract tests (vm sandbox — no DOM needed).
 * They encode the REAL k2-fsa/OmniVoice wire format:
 *   submit → POST /gradio_api/call/_clone_fn  {data:[12 params]} → {event_id}
 *   stream → GET  /gradio_api/call/_clone_fn/<id>  (SSE)
 *            event: complete   data: [output_audio, status]
 *            event: error      data: null | {msg: "..."}
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { FakeEventSource } = require('./helpers/fake_event_source');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'static', 'js', 'gradio_api.js'), 'utf8');

function makeEnv(t) {
  const fetchCalls = [];
  const fetchResponses = [];
  const timers = new Set();
  const sandbox = {
    fetch: (url, opts) => {
      fetchCalls.push({ url: String(url), opts });
      const next = fetchResponses.shift() ||
        { ok: true, json: async () => ({ event_id: 'evt-1' }) };
      return Promise.resolve(next);
    },
    EventSource: FakeEventSource,
    DOMException, URL, console, Blob, File, FormData, structuredClone,
    setTimeout: (fn, ms, ...a) => {
      const id = setTimeout(fn, ms, ...a);
      timers.add(id);
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); return clearTimeout(id); },
  };
  sandbox.URL.createObjectURL = () => 'blob:obj';
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const env = { sandbox, fetchCalls, fetchResponses };
  env.clearTimers = () => { for (const id of timers) clearTimeout(id); timers.clear(); };
  if (t) t.after(env.clearTimers);
  return env;
}

const audioFileData = { path: '/tmp/gradio/abc/ref.wav', orig_name: 'ref.wav',
                        meta: { _type: 'gradio.FileData' } };
const AUDIO_URL = 'https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/o.wav';

function feedAudioResponse(env) {
  env.sandbox.fetch = (url) => {
    env.fetchCalls.push({ url: String(url), opts: {} });
    return Promise.resolve({ ok: true, json: async () => ({}),
                             blob: async () => ({ size: 4, type: 'audio/wav' }) });
  };
}

test('uploadToGradio posts to /gradio_api/upload with field "files"', t => {
  const env = makeEnv(t);
  env.sandbox.fetch = (url, opts) => {
    env.fetchCalls.push({ url: String(url), opts });
    return Promise.resolve({ ok: true,
                             json: async () => ['/tmp/gradio/abc/ref.wav'] });
  };
  const file = new File([new Uint8Array([1, 2, 3])], 'ref.wav', { type: 'audio/wav' });
  return env.sandbox.uploadToGradio(file).then(fd => {
    const call = env.fetchCalls.at(-1);
    assert.match(call.url, /\/gradio_api\/upload$/);
    assert.ok(call.opts.body instanceof FormData);
    assert.ok(call.opts.body.get('files'));
    assert.equal(fd.path, '/tmp/gradio/abc/ref.wav');
    assert.equal(fd.orig_name, 'ref.wav');
    assert.equal(fd.meta._type, 'gradio.FileData');
  });
});

test('upload failure is reported', t => {
  const env = makeEnv(t);
  env.sandbox.fetch = () => Promise.resolve({ ok: false, status: 413,
                                              statusText: 'Payload Too Large' });
  return assert.rejects(
    () => env.sandbox.uploadToGradio(new File(['x'], 'a.wav')), /413/);
});

test('generate submit posts 12 params in OmniVoice order', async t => {
  const env = makeEnv(t);
  env.sandbox.generateVoiceGradio({
    text: 'مرحبا', language: 'Auto', refAudio: audioFileData, refText: 'r',
    instruct: 'Male', ns: 16, gs: 3, dn: true, sp: 1.5, du: null, pp: true, po: true,
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 5));
  const submit = env.fetchCalls.find(c => c.url.includes('/gradio_api/call/_clone_fn')
                                      && c.opts.method === 'POST');
  assert.ok(submit, 'submit call missing');
  assert.equal(submit.opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(submit.opts.body).data, [
    'مرحبا', 'Auto', audioFileData, 'r', 'Male', 16, 3, true, 1.5, null, true, true,
  ]);
});

test('submit failure surfaces server body', t => {
  const env = makeEnv(t);
  env.fetchResponses.push({ ok: false, status: 500, statusText: 'Server Error',
                            text: async () => 'upload too big' });
  return assert.rejects(() => env.sandbox.generateVoiceGradio({ text: 'x' }),
                        /upload too big/);
});

test('missing event_id throws', t => {
  const env = makeEnv(t);
  env.fetchResponses.push({ ok: true, json: async () => ({}) });
  return assert.rejects(() => env.sandbox.generateVoiceGradio({ text: 'x' }),
                        /event_id/);
});

test('completion resolves object URL from an absolute audio url', async t => {
  const env = makeEnv(t);
  const done = env.sandbox.generateVoiceGradio({ text: 'x' });
  await new Promise(r => setTimeout(r, 5));
  const es = FakeEventSource.last();
  assert.match(es.url, /\/gradio_api\/call\/_clone_fn\/evt-1$/);
  feedAudioResponse(env);
  es.emit('complete', [{ url: AUDIO_URL }, 'ok']);
  await done;
  assert.match(env.fetchCalls.at(-1).url, /^https:\/\/k2-fsa-omnivoice\.hf\.space\/gradio_api\/file=/);
});

test('completion handles RELATIVE audio url (real Gradio behaviour)', async t => {
  const env = makeEnv(t);
  const done = env.sandbox.generateVoiceGradio({ text: 'x' });
  await new Promise(r => setTimeout(r, 5));
  feedAudioResponse(env);
  FakeEventSource.last().emit('complete', [{ url: '/gradio_api/file=/tmp/o.wav' }, 'ok']);
  await done;
  assert.match(env.fetchCalls.at(-1).url,
    /^https:\/\/k2-fsa-omnivoice\.hf\.space\/gradio_api\/file=/);
});

test('completion falls back to /gradio_api/file=<path>', async t => {
  const env = makeEnv(t);
  const done = env.sandbox.generateVoiceGradio({ text: 'x' });
  await new Promise(r => setTimeout(r, 5));
  feedAudioResponse(env);
  FakeEventSource.last().emit('complete', [{ path: '/tmp/o.wav' }, 'ok']);
  await done;
  assert.equal(env.fetchCalls.at(-1).url,
    'https://k2-fsa-omnivoice.hf.space/gradio_api/file=/tmp/o.wav');
});

test('audio download failure rejects', async t => {
  const env = makeEnv(t);
  const done = env.sandbox.generateVoiceGradio({ text: 'x' });
  await new Promise(r => setTimeout(r, 5));
  env.sandbox.fetch = () => Promise.resolve({ ok: false, status: 404,
                                              json: async () => ({}) });
  FakeEventSource.last().emit('complete', [{ url: AUDIO_URL }, 'ok']);
  await assert.rejects(done, /فشل تحميل/);
});

test('error event rejects with a readable message', async t => {
  const env = makeEnv(t);
  const done = env.sandbox.generateVoiceGradio({ text: 'x' });
  await new Promise(r => setTimeout(r, 5));
  FakeEventSource.last().emit('error', null);
  await assert.rejects(done, /OmniVoice|تعذّر/);
});

test('job error with server msg is surfaced', async t => {
  const env = makeEnv(t);
  const done = env.sandbox.generateVoiceGradio({ text: 'x' });
  await new Promise(r => setTimeout(r, 5));
  FakeEventSource.last().emit('error', { msg: 'ZeroGPU quota exceeded' });
  await assert.rejects(done, /ZeroGPU quota exceeded/);
});

test('progress events map to the ratio callback', async t => {
  const env = makeEnv(t);
  const progress = [];
  const done = env.sandbox.generateVoiceGradio({
    text: 'x', onProgress: (stage, ratio) => progress.push([stage, ratio]),
  });
  await new Promise(r => setTimeout(r, 5));
  const es = FakeEventSource.last();
  es.emit('process_generating', { progress_data: [{ index: 2, length: 8 }] });
  es.emit('process_starts', { progress_data: [{ progress: 0.5 }] });
  // progress[0] is 'queued' (submit step); generating events follow
  const generating = progress.filter(p => p[0] === 'generating');
  assert.equal(generating[0][1], 0.25);
  assert.equal(generating[1][1], 0.5);
  feedAudioResponse(env);
  es.emit('complete', [{ url: AUDIO_URL }, 'ok']);
  await done;
});

test('abort rejects and closes the stream', async t => {
  const env = makeEnv(t);
  const ac = new AbortController();
  const done = env.sandbox.generateVoiceGradio({ text: 'x', signal: ac.signal });
  await new Promise(r => setTimeout(r, 5));
  const es = FakeEventSource.last();
  ac.abort();
  await assert.rejects(done, (e) => e.name === 'AbortError');
  assert.equal(es.closed, true);
});

test('pre-aborted signal short-circuits', t => {
  const env = makeEnv(t);
  const ac = new AbortController();
  ac.abort();
  return assert.rejects(
    () => env.sandbox.generateVoiceGradio({ text: 'x', signal: ac.signal }),
    (e) => e.name === 'AbortError').then(() => assert.equal(env.fetchCalls.length, 0));
});

test('reference audio is uploaded before submission', async t => {
  const env = makeEnv(t);
  env.sandbox.fetch = (url, opts) => {
    env.fetchCalls.push({ url: String(url), opts });
    if (String(url).includes('/gradio_api/upload')) {
      return Promise.resolve({ ok: true, json: async () => ['/tmp/srv/ref.wav'] });
    }
    return Promise.resolve({ ok: true, json: async () => ({ event_id: 'evt-1' }) });
  };
  const file = new File([new Uint8Array([9])], 'ref.wav', { type: 'audio/wav' });
  env.sandbox.generateVoiceGradio({ text: 'x', refAudio: file }).catch(() => {});
  await new Promise(r => setTimeout(r, 5));
  const upload = env.fetchCalls.find(c => c.url.includes('/gradio_api/upload'));
  assert.ok(upload, 'reference audio never uploaded');
  const submit = env.fetchCalls.find(c => c.url.includes('/gradio_api/call/_clone_fn')
                                      && c.opts.method === 'POST');
  assert.ok(submit, 'submission missing after upload');
  const body = JSON.parse(submit.opts.body).data;
  assert.equal(body[2].path, '/tmp/srv/ref.wav');
});
