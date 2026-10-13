'use strict';
/**
 * jsdom application environment: loads static/index.html and evaluates the
 * real front-end scripts (gradio_api.js → app.js) with every browser API the
 * app touches stubbed and controllable from tests.
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { FakeEventSource } = require('./fake_event_source');
const { installFakeIndexedDB } = require('./fake_indexeddb');

const ROOT = path.join(__dirname, '..', '..');
const STATIC = path.join(ROOT, 'static');

function readStatic(rel) { return fs.readFileSync(path.join(STATIC, rel), 'utf8'); }

/** Response-like object good enough for the app's fetch usage. */
function jsonResponse(body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: true, status: 200, statusText: 'OK',
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => payload,
    blob: async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' }),
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  };
}

function errorResponse(status = 500, text = 'boom') {
  return { ok: false, status, statusText: text, text: async () => text, json: async () => ({}) };
}

function makeCanvas2D() {
  const gradient = { addColorStop() {} };
  return {
    canvas: { width: 0, height: 0 },
    createLinearGradient: () => gradient,
    scale() {}, clearRect() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    arc() {}, rect() {},
    fillStyle: '', strokeStyle: '', lineWidth: 1,
  };
}

function makeAudioContext() {
  return {
    state: 'running', currentTime: 0, sampleRate: 16000,
    resume: async () => {}, close: async () => {},
    decodeAudioData: async () => ({
      sampleRate: 16000, numberOfChannels: 1, length: 64,
      getChannelData: () => new Float32Array(64),
    }),
    createBuffer: (ch, len, sr) => ({
      numberOfChannels: ch, length: len, sampleRate: sr,
      getChannelData: () => new Float32Array(len),
    }),
    createBufferSource: () => ({ buffer: null, loop: false, connect() {}, start() {}, stop() {} }),
    createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }),
    createBiquadFilter: () => ({ type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} }),
    createOscillator: () => ({ type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }),
    destination: {},
  };
}

function loadApp({ withEventSource = true, seedTheme = null } = {}) {
  const html = readStatic('index.html');
  const vc = new VirtualConsole(); // swallow jsdom "Not implemented" noise
  vc.on('jsdomError', () => {});
  const dom = new JSDOM(html, {
    url: 'http://localhost:7860/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;

  // ── stubs the app expects (or crashes without) ──
  window.AudioContext = function () { return makeAudioContext(); };
  window.webkitAudioContext = window.AudioContext;
  window.HTMLCanvasElement.prototype.getContext = function () { return makeCanvas2D(); };
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.Element.prototype.scrollIntoView = function () {};

  // track every timer so tests can drain them (the app arms 180s timeouts)
  const pendingTimers = new Set();
  const realSetTimeout = setTimeout;
  const realClearTimeout = clearTimeout;
  window.setTimeout = (fn, ms, ...args) => {
    const id = realSetTimeout(fn, ms, ...args);
    pendingTimers.add(id);
    return id;
  };
  window.clearTimeout = (id) => { pendingTimers.delete(id); return realClearTimeout(id); };

  let blobSeq = 0;
  window.URL.createObjectURL = () => `blob:fake-${++blobSeq}`;
  window.URL.revokeObjectURL = () => {};
  FakeEventSource.reset();
  if (withEventSource) window.EventSource = FakeEventSource;

  const env = {
    dom, window,
    document: window.document,
    fetchCalls: [],
    fetchHandler: () => jsonResponse({ event_id: 'evt-test' }),
    idb: installFakeIndexedDB(window),
    EventSource: FakeEventSource,
    clearTimers() {
      for (const id of pendingTimers) realClearTimeout(id);
      pendingTimers.clear();
    },
  };
  window.fetch = (url, opts) => {
    env.fetchCalls.push({ url: String(url), opts });
    return Promise.resolve(env.fetchHandler(url, opts));
  };

  if (seedTheme) window.localStorage.setItem('talky_theme', seedTheme);

  // ── evaluate the real front-end scripts in window scope, in order ──
  window.eval(readStatic('js/vendor.js'));
  window.eval(readStatic('js/gradio_api.js'));
  window.eval(readStatic('js/app.js'));
  return env;
}

module.exports = { loadApp, jsonResponse, errorResponse, readStatic, makeCanvas2D };
