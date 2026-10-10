// Shows exactly what probability data the engine sends, and whether confidence.js can read it.
//   node eval/check-logprobs.js --model gemma-4-26b-a4b --backend gpu --yes
// Loads the chat model for about a minute and generates one short answer.
const { start, arg, requireYes } = require('./_engine.js');
const path = require('path');
const C = require(path.join(__dirname, '..', 'src', 'confidence.js'));
requireYes('Check what token-probability data this engine build sends.');

(async () => {
  const eng = await start({ modelId: arg('model', 'gemma-4-26b-a4b'), backend: arg('backend', 'cpu') });
  try {
    const chunks = [];
    let buf = '';
    await eng.post('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'What is the default TCP port for RDP? Answer in one short sentence.' }],
      stream: true, logprobs: true, top_logprobs: 3, max_tokens: 400, temperature: 0,
    }, text => {
      buf += text;
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) if (l.startsWith('data: ') && l.slice(6).trim() !== '[DONE]') { try { chunks.push(JSON.parse(l.slice(6))); } catch { /* partial */ } }
    });
    const withDelta = chunks.filter(c => c.choices?.[0]?.delta?.content);
    const withReason = chunks.filter(c => c.choices?.[0]?.delta?.reasoning_content);
    console.log(`chunks: ${chunks.length} | with answer text: ${withDelta.length} | with reasoning text: ${withReason.length}`);
    console.log('top-level keys of an answer chunk:', Object.keys(withDelta[0] || {}).join(', '));
    console.log('choice keys:', Object.keys(withDelta[0]?.choices?.[0] || {}).join(', '));
    console.log('\nraw logprobs part of the first answer chunk:\n' + JSON.stringify(withDelta[0]?.choices?.[0]?.logprobs ?? withDelta[0]?.completion_probabilities ?? '(none found)', null, 1).slice(0, 700));
    const entries = withDelta.flatMap(c => C.entriesFromChunk(c));
    const words = C.toWords(entries);
    console.log(`\nconfidence.js read ${entries.length} token entries from ${withDelta.length} answer chunks.`);
    console.log('words with the least-confident token each:\n' + words.map(w => `  ${w.text.padEnd(14)} min p = ${w.minP.toFixed(3)}`).join('\n'));
    console.log(entries.length ? '\nOK: the engine sends probabilities and the parser understands them.' : '\nPROBLEM: no probabilities were parsed. Paste the raw part above to me.');
  } finally { await eng.stop(); }
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
