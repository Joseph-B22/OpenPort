// Engine tuning options (Settings → Engine). Shared by main.js and eval/bench-speed.js so the benchmark measures exactly
// the flags the app uses. Measured on the home PC with eval/bench-speed.js and eval/bench-cpu-memory.js (2026-10-09).
//
//  kvCache 'q8_0'  stores the conversation's working memory (KV cache) in 8 bits instead of 16 (needs flash attention).
//                  Gemma 4 26B on GPU: identical answers, 12/12 starter tests, 5-25% faster, little memory saved at 8K.
//  copyAhead       n-gram "lookup" speculative decoding: when the answer repeats text that is already in the prompt (fixing
//                  a config, rewriting a script, quoting a log), the engine proposes the next words by copying them from
//                  the prompt and the model only verifies them. No extra model; with greedy decoding the output is identical.
//                  "Fix and return this config": 64 -> 396 tok/s on GPU, 18 -> 44 tok/s on CPU. Normal chat unchanged.
//  cpuLowMemory    CPU engine only: don't make a second, CPU-optimised copy of the weights ("repacking"); the model is read
//                  straight from the file. 26B on CPU: RAM 23.4 -> 13.9 GB, load 13 -> 3 s, same writing speed, but reading a
//                  long prompt 85 -> 61 tok/s. On by default (a 32 GB laptop needs the memory more than the prompt speed).
const COPY_AHEAD_TYPES = ['ngram-simple', 'ngram-mod', 'ngram-map-k'];   // ngram-simple measured best on this PC

const cpuLowMemory = tuning => tuning?.cpuLowMemory !== false;

function tuningArgs(tuning = {}, backend = 'vulkan') {
  const args = [];
  if (tuning.kvCache === 'q8_0') args.push('-fa', 'on', '-ctk', 'q8_0', '-ctv', 'q8_0');
  if (tuning.copyAhead) {
    const type = COPY_AHEAD_TYPES.includes(tuning.copyAheadType) ? tuning.copyAheadType : 'ngram-simple';
    args.push('--spec-type', type);
  }
  if (backend === 'cpu' && cpuLowMemory(tuning)) args.push('--no-repack');
  return args;
}

// Windows "commit" the engine will reserve. GPU and CPU-with-repack reserve about the model's size; CPU low-memory mode reads
// the file through mmap (file-backed pages, not commit) and reserves only working buffers (~2 GB measured).
function commitNeed(modelBytes, backend, tuning, embedderRunning) {
  const extra = 3e9 + (embedderRunning ? 1e9 : 0);
  return backend === 'cpu' && cpuLowMemory(tuning) ? extra : modelBytes * 1.15 + extra;
}

module.exports = { tuningArgs, commitNeed, cpuLowMemory, COPY_AHEAD_TYPES };
