// api-chat.mjs — 调用兼容 OpenAI 的 /chat/completions 流式接口，以及给 API 协作方的报告做 schema 校验。
// 不依赖 messages.mjs：出错时抛出带 kind 的错误，由 bridge.mjs 翻译成给人看的文字。

function apiError(kind, message, status) {
  return Object.assign(new Error(message), { kind, status });
}

export async function chatStream({ url, apiKey, body, timeoutMs, stallMs, onEvent = () => {} }) {
  const controller = new AbortController();
  let abortKind = null;
  const abort = (kind) => { abortKind ??= kind; controller.abort(); };
  const timeout = setTimeout(() => abort('timeout'), timeoutMs);
  let stall;
  const activity = () => {
    clearTimeout(stall);
    if (stallMs > 0) stall = setTimeout(() => abort('stall'), stallMs);
  };
  activity();
  let content = '';
  let reasoning = '';
  let usage = null;
  let finishReason = null;
  let completed = false;
  let pendingContent = '';
  let pendingReasoning = '';
  const flush = () => {
    if (pendingReasoning) onEvent({ type: 'api.reasoning', text: pendingReasoning, total_chars: reasoning.length });
    if (pendingContent) onEvent({ type: 'api.content', text: pendingContent, total_chars: content.length });
    pendingReasoning = pendingContent = '';
  };
  const batches = setInterval(flush, 1000);
  let reader;
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
    });
    activity(); // 收到响应头也算有动静，卡死只按之后的数据间隔算
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    if (!response.ok) {
      const status = response.status;
      const kind = status === 401 || status === 403 ? 'auth' : status === 402 ? 'balance'
        : status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'bad_request';
      let text = '';
      // 错误体只用来补充说明；读不完（超时、断开）时仍按状态码分类，不能被当成卡死或网络故障。
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          activity();
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } catch { /* 用已经读到的部分 */ }
      let message;
      try { message = JSON.parse(text).error?.message; } catch { /* 非 JSON 错误只保留短摘要 */ }
      throw apiError(kind, message || text.slice(0, 500) || `HTTP ${status}`, status);
    }
    let buffer = '';
    let data = [];
    let ended = false;
    const dispatch = () => {
      if (!data.length) return;
      const text = data.join('\n');
      data = [];
      if (!text.trim()) return; // SSE 规范里 data 为空的事件不派发
      if (text.trim() === '[DONE]') { ended = true; return; }
      let event;
      try { event = JSON.parse(text); }
      catch { throw apiError('network', 'Invalid JSON in SSE data'); }
      if (event.error) throw apiError('server', event.error.message || 'Stream error');
      const choice = event.choices?.[0];
      const delta = choice?.delta;
      if (delta?.reasoning_content) { reasoning += delta.reasoning_content; pendingReasoning += delta.reasoning_content; }
      if (delta?.content) {
        // 首段回答及时展示，后续按批次写事件。
        const first = !content;
        content += delta.content;
        pendingContent += delta.content;
        if (first) flush();
      }
      if (choice?.finish_reason != null) finishReason = choice.finish_reason;
      if (event.usage) usage = event.usage;
      if (pendingContent.length + pendingReasoning.length >= 2000) flush();
    };
    const line = (text) => {
      if (!text) dispatch();
      else if (text.startsWith('data:')) data.push(text.slice(5).replace(/^ /, ''));
    };
    while (!ended) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer) line(buffer.replace(/\r$/, ''));
        // 连接断在最后半行时，已经收到 finish_reason 就说明回答完整，残缺的尾巴不算错，免得整次重试。
        try { dispatch(); } catch (e) { if (!finishReason) throw e; }
        if (!ended && !finishReason) throw apiError('network', 'Stream ended before completion');
        break;
      }
      activity();
      buffer += decoder.decode(value, { stream: true });
      let i;
      while (!ended && (i = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, i).replace(/\r$/, ''));
        buffer = buffer.slice(i + 1);
      }
    }
    flush();
    completed = true;
    return { content, reasoning, usage, finishReason };
  } catch (error) {
    if (error.kind) throw error;
    if (abortKind) throw apiError(abortKind, abortKind === 'stall' ? 'No bytes received within the stall limit' : 'Request timed out');
    // fetch / undici 的连接、headers 和 body 超时都按网络故障处理。
    throw apiError('network', error.message);
  } finally {
    clearTimeout(timeout);
    clearTimeout(stall);
    clearInterval(batches);
    // 先关连接，后面写事件出错也不会把连接留着。
    if (reader) await reader.cancel().catch(() => {});
    flush();
    if (usage) onEvent({ type: 'api.usage', usage });
    if (completed) onEvent({ type: 'api.done', finish_reason: finishReason });
  }
}

export function validateSchema(schema, value) {
  const errors = [];
  const check = (rule, item, at) => {
    const label = at || '$';
    const type = Array.isArray(item) ? 'array' : item === null ? 'null' : typeof item;
    if (rule.type && type !== rule.type) { errors.push(`${label} must be ${rule.type}`); return; }
    if (rule.enum && !rule.enum.includes(item)) errors.push(`${label} must be one of ${rule.enum.join(', ')}`);
    if (type === 'object') {
      for (const key of rule.required || []) {
        if (!Object.hasOwn(item, key)) errors.push(`${at ? `${at}.` : ''}${key} is required`);
      }
      for (const [key, val] of Object.entries(item)) {
        const next = at ? `${at}.${key}` : key;
        if (Object.hasOwn(rule.properties || {}, key)) check(rule.properties[key], val, next);
        else if (rule.additionalProperties === false) errors.push(`${next} is not allowed`);
      }
    } else if (type === 'array' && rule.items) item.forEach((val, i) => check(rule.items, val, `${at}[${i}]`));
  };
  check(schema, value, '');
  return errors;
}
