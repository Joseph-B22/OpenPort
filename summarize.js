// Map-reduce summarizer: splits a long text into pieces that fit the model's context, summarizes each,
// then merges the summaries. Talks only to the local llama-server.
const http = require('http');

const MAX_CHUNKS = 40;                                    // ~ a few hundred pages; beyond that, use search instead

function splitText(text, size) {
  const chunks = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) chunks.push(rest);
  return chunks;
}

function complete(port, prompt, signal) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: prompt }], stream: false, temperature: 0.2, max_tokens: 1500,
      chat_template_kwargs: { enable_thinking: false },
    });
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST', timeout: 600000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`engine ${res.statusCode}: ${buf.slice(0, 200)}`));
        try { resolve((JSON.parse(buf).choices[0].message.content || '').trim()); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('summarizer request timed out')));
    signal?.addEventListener('abort', () => req.destroy(new Error('Cancelled')));
    req.write(body); req.end();
  });
}

async function summarize({ port, text, focus, contextSize, onProgress, signal }) {
  const size = Math.floor(contextSize * 3 * 0.5);        // chars per piece (~3 chars/token, half the window)
  let pieces = splitText(text, size);
  let truncated = false;
  if (pieces.length > MAX_CHUNKS) { pieces = pieces.slice(0, MAX_CHUNKS); truncated = true; }
  const goal = focus ? ` The reader especially cares about: ${focus}.` : '';
  const exact = 'Keep names, numbers, versions, hostnames, IPs, commands and dates exact.';

  let notes;
  if (pieces.length === 1) {
    onProgress?.({ step: 1, of: 1 });
    notes = [await complete(port, `Summarize this document clearly and concisely.${goal} ${exact}\n\n${pieces[0]}`, signal)];
  } else {
    notes = [];
    for (let i = 0; i < pieces.length; i++) {
      onProgress?.({ step: i + 1, of: pieces.length + 1 });
      notes.push(await complete(port, `This is part ${i + 1} of ${pieces.length} of a long document. Summarize it in under 150 words.${goal} ${exact}\n\n${pieces[i]}`, signal));
    }
    // merge until the notes fit in one request
    while (notes.join('\n\n').length > size) {
      const groups = splitText(notes.join('\n\n'), size);
      notes = [];
      for (const g of groups) notes.push(await complete(port, `Merge these partial summaries into one shorter summary. ${exact}\n\n${g}`, signal));
    }
    onProgress?.({ step: pieces.length + 1, of: pieces.length + 1 });
    notes = [await complete(port, `Below are summaries of consecutive parts of one document. Write a single, well-organized summary of the whole document.${goal} ${exact}\n\n${notes.join('\n\n')}`, signal)];
  }
  return { summary: notes[0], pieces: pieces.length, truncated };
}

module.exports = { summarize, splitText };
