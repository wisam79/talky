'use strict';
/**
 * Controllable EventSource fake.
 *
 * The real OmniVoice stream sends *named* events (`event: complete`,
 * `event: error`) whose data is a raw JSON array. jsdom has no EventSource,
 * so tests inject this and drive the wire format explicitly.
 */
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    this.onmessage = null;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  /** Emit a server frame: emit('complete', [audio, status]) or emit('error', null). */
  emit(type, data) {
    const ev = { type, data: typeof data === 'string' ? data : JSON.stringify(data) };
    for (const fn of this.listeners.get(type) || []) fn(ev);
    if (type === 'message' && typeof this.onmessage === 'function') this.onmessage(ev);
  }

  close() { this.closed = true; }
}

FakeEventSource.instances = [];
FakeEventSource.reset = () => { FakeEventSource.instances.length = 0; };
FakeEventSource.last = () => FakeEventSource.instances.at(-1);

/** Emit the *real* wire format produced by k2-fsa/OmniVoice. */
function emitRealCompletion(es, output, status = 'ok') {
  es.emit('complete', [output, status]);
}

module.exports = { FakeEventSource, emitRealCompletion };
