// Does the model's own uncertainty predict its mistakes? Asks ~90 IT fact questions, records the probability of
// every value the model wrote, and checks whether low confidence on a value goes with a wrong answer.
//   node eval/exp-confidence.js --model gemma-4-26b-a4b --backend gpu --yes
// Loads the chat model; about 90 short generations (a few minutes on GPU, much longer on CPU).
const fs = require('fs'), path = require('path');
const { start, arg, requireYes } = require('./_engine.js');
const C = require(path.join(__dirname, '..', 'src', 'confidence.js'));
const facts = require('./facts.js');
requireYes('Does token-level confidence predict wrong answers?');

// Area under the ROC curve: the chance that a randomly chosen correct answer has higher confidence than a wrong one.
function auroc(scores, labels) {                         // labels: 1 = correct
  const pos = scores.filter((_, i) => labels[i] === 1), neg = scores.filter((_, i) => labels[i] === 0);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

(async () => {
  const limit = +arg('limit', facts.length);
  const eng = await start({ modelId: arg('model', 'gemma-4-26b-a4b'), backend: arg('backend', 'cpu') });
  const rows = [];
  try {
    for (const [q, expect] of facts.slice(0, limit)) {
      const chunks = [];
      let buf = '';
      try {
        await eng.post('/v1/chat/completions', {
          messages: [{ role: 'user', content: `${q} Reply with only the value, no explanation.` }],
          stream: true, logprobs: true, top_logprobs: 3, max_tokens: 600, temperature: 0,
        }, text => { buf += text; const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) if (l.startsWith('data: ') && l.slice(6).trim() !== '[DONE]') { try { chunks.push(JSON.parse(l.slice(6))); } catch { /* partial */ } } });
      } catch (e) { rows.push({ q, expect, error: e.message }); continue; }
      const content = chunks.map(c => c.choices?.[0]?.delta?.content || '').join('');
      const answerEntries = chunks.filter(c => c.choices?.[0]?.delta?.content).flatMap(c => C.entriesFromChunk(c));
      const words = C.toWords(answerEntries);
      const factWords = words.filter(w => /\d/.test(w.text) || /^[0-9a-f]{3,}$/i.test(w.text));
      const minP = factWords.length ? Math.min(...factWords.map(w => w.minP)) : null;
      rows.push({ q, expect, content: content.trim().slice(0, 80), correct: content.toLowerCase().includes(expect.toLowerCase()), minP, hasProbs: answerEntries.length > 0 });
      process.stdout.write(rows[rows.length - 1].correct ? '.' : 'x');
    }
  } finally { await eng.stop(); }

  const usable = rows.filter(r => !r.error && r.minP !== null);
  const right = usable.filter(r => r.correct), wrong = usable.filter(r => !r.correct);
  console.log(`\n\nAnswered ${rows.length} questions: ${rows.filter(r => r.correct).length} correct, ${rows.filter(r => !r.error && !r.correct).length} wrong, ${rows.filter(r => r.error).length} errors.`);
  if (!usable.length) { console.log('No probability data was usable. Run check-logprobs.js first.'); return; }
  console.log(`Median confidence on the value: correct answers ${med(right.map(r => r.minP)).toFixed(3)} | wrong answers ${wrong.length ? med(wrong.map(r => r.minP)).toFixed(3) : 'n/a'}`);
  const auc = auroc(usable.map(r => r.minP), usable.map(r => (r.correct ? 1 : 0)));
  console.log(`AUROC (1.0 = confidence perfectly separates right from wrong, 0.5 = useless): ${auc === null ? 'n/a (need both right and wrong answers)' : auc.toFixed(3)}`);
  console.log('\n| Flag when confidence below | Wrong answers caught | Correct answers flagged (false alarms) |\n|---|---|---|');
  for (const t of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    const caught = wrong.filter(r => r.minP < t).length, alarms = right.filter(r => r.minP < t).length;
    console.log(`| ${t} | ${caught}/${wrong.length} | ${alarms}/${right.length} (${right.length ? Math.round(100 * alarms / right.length) : 0}%) |`);
  }
  console.log('\nWrong answers:\n' + wrong.map(r => `  Q: ${r.q}\n     expected ${r.expect}, got "${r.content}" (confidence ${r.minP.toFixed(2)})`).join('\n'));
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', `confidence-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ model: arg('model'), auc, rows }, null, 2));
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });

function med(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; }
