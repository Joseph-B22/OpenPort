// Pure prompt-planning logic (no DOM, no network) so it can be unit-tested.
//
// Why this exists: the engine remembers the start of the previous prompt and only reads what is new, but ONLY if
// the beginning of each request is byte-for-byte identical to the last one. So we keep the stable parts first
// (system prompt, then the conversation) and put anything that changes from question to question (recalled notes,
// retrieved passages) right next to the new question. And when the window is full, we drop old messages in
// chunks (hysteresis) instead of one at a time, so the start of the prompt stays unchanged for several turns.
(function (root) {
  const IMAGE_TOKENS = 300;         // rough cost of one attached image (varies by model)
  const TEMPLATE_OVERHEAD = 10;     // per-message role markers etc.

  const estimateTokens = text => Math.ceil((text || '').length / 3);

  // Splits a message's content into the text we can count exactly and the number of images.
  function contentParts(content) {
    if (typeof content === 'string') return { text: content, images: 0 };
    return {
      text: content.filter(p => p.type === 'text').map(p => p.text).join('\n'),
      images: content.filter(p => p.type === 'image_url').length,
    };
  }

  // counts[i] = tokens of message i (from the tokenizer or an estimate).
  // pinned/excluded: Sets of message indices. startHint: where the window started last turn (only moves forward).
  function planWindow({ counts, pinned = new Set(), excluded = new Set(), startHint = 0, limit, lowWater = 0.7 }) {
    const n = counts.length;
    const last = n - 1;
    const cost = i => counts[i];

    // Pins win over the sliding window, but if pins alone would take most of the window, drop the oldest pins.
    const pins = [...pinned].filter(i => i >= 0 && i < last && !excluded.has(i)).sort((a, b) => a - b);
    let pinTotal = pins.reduce((s, i) => s + cost(i), 0);
    const droppedPins = [];
    while (pins.length && pinTotal > limit * 0.6) { const i = pins.shift(); pinTotal -= cost(i); droppedPins.push(i); }
    const pinSet = new Set(pins);

    const slidingTotal = start => {
      let t = cost(last);                                  // the current turn is always included
      for (let i = start; i < last; i++) if (!excluded.has(i) && !pinSet.has(i)) t += cost(i);
      return t;
    };

    let start = Math.min(Math.max(0, startHint), last);
    if (pinTotal + slidingTotal(start) > limit) {
      // Over budget: advance in one jump to the lower watermark so the next several turns reuse the same prefix.
      const target = Math.max(0, limit * lowWater - pinTotal);
      while (start < last && slidingTotal(start) > target) start++;
    }

    const included = [];
    for (let i = 0; i <= last; i++) {
      if (i === last || pinSet.has(i) || (i >= start && !excluded.has(i))) included.push(i);
    }
    const includedSet = new Set(included);
    const outOfView = [];
    for (let i = 0; i < n; i++) if (!includedSet.has(i) && !excluded.has(i)) outOfView.push(i);
    const total = included.reduce((s, i) => s + cost(i), 0);
    return { start, included, outOfView, excluded: [...excluded].filter(i => i < n).sort((a, b) => a - b), pinned: pins, droppedPins, total };
  }

  // Puts per-question context in front of the final user message (so it comes AFTER the stable conversation).
  function augment(content, volatileText) {
    if (!volatileText) return content;
    if (typeof content === 'string') return `${volatileText}\n\n${content}`;
    const out = content.map(p => ({ ...p }));
    const i = out.findIndex(p => p.type === 'text');
    if (i >= 0) out[i].text = `${volatileText}\n\n${out[i].text}`; else out.push({ type: 'text', text: volatileText });
    return out;
  }

  // Final message list for the engine: stable system prompt, the chosen conversation messages, and the volatile
  // context folded into the last user message.
  function buildMessages({ history, included, systemText, volatileText }) {
    const msgs = included.map(i => ({ role: history[i].role, content: history[i].content }));
    const lastIdx = msgs.length - 1;
    if (lastIdx >= 0 && msgs[lastIdx].role === 'user') msgs[lastIdx] = { role: 'user', content: augment(msgs[lastIdx].content, volatileText) };
    return [{ role: 'system', content: systemText }, ...msgs];
  }

  const api = { IMAGE_TOKENS, TEMPLATE_OVERHEAD, estimateTokens, contentParts, planWindow, augment, buildMessages };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PromptPlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
