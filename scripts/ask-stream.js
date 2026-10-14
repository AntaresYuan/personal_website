/* Incremental NDJSON reader for Ask Antares. Kept separate from work.js so
   split UTF-8 chunks and event ordering can be tested without a browser. */
(function (root) {
  'use strict';

  var isStreaming = function (response) {
    return !!(response && response.body && typeof response.body.getReader === 'function' &&
      /application\/x-ndjson/i.test(response.headers && response.headers.get('content-type') || ''));
  };

  var consume = async function (response, onEvent) {
    if (!isStreaming(response)) return null;
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var result = { answer: '', via: '', model: '', resources: [], ui: [], tools: [], traceId: '' };
    var accept = function (line) {
      if (!line.trim()) return;
      var event = JSON.parse(line);
      if (event.type === 'error') throw new Error(String(event.error || 'stream failed'));
      if (event.type === 'meta' || event.type === 'done') {
        if (event.via) result.via = String(event.via);
        if (event.model) result.model = String(event.model);
        if (event.traceId) result.traceId = String(event.traceId);
        if (Array.isArray(event.resources)) result.resources = event.resources;
        if (Array.isArray(event.ui)) result.ui = event.ui;
        if (Array.isArray(event.tools)) result.tools = event.tools;
        if (event.type === 'done' && event.answer) result.answer = String(event.answer);
      } else if (event.type === 'delta') {
        result.answer += String(event.text || '');
      }
      if (typeof onEvent === 'function') onEvent(event, result);
    };
    while (true) {
      var part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(accept);
    }
    buffer += decoder.decode();
    if (buffer.trim()) accept(buffer);
    if (!result.answer.trim()) throw new Error('stream returned no answer');
    result.answer = result.answer.trim();
    return result;
  };

  root.ASK_STREAM = { isStreaming: isStreaming, consume: consume };
})(typeof window !== 'undefined' ? window : globalThis);
