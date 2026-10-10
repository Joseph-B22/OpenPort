// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
// Engine tuning flags (8-bit KV cache, copy-ahead) are exactly what llama.cpp expects, and off by default.
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const { tuningArgs } = require(ROOT + '/tuning.js');

ok(tuningArgs().length === 0 && tuningArgs({ kvCache: 'f16', copyAhead: false }).length === 0, 'defaults add no engine flags');
ok(tuningArgs({ kvCache: 'q8_0' }).join(' ') === '-fa on -ctk q8_0 -ctv q8_0', '8-bit KV cache turns on flash attention (needed for a quantized V cache) and sets both K and V');
ok(tuningArgs({ copyAhead: true }).join(' ') === '--spec-type ngram-simple', 'copy-ahead defaults to ngram-simple lookup (measured fastest here)');
ok(tuningArgs({ copyAhead: true, copyAheadType: 'ngram-mod' }).join(' ') === '--spec-type ngram-mod', 'a chosen lookup type is used');
ok(tuningArgs({ copyAhead: true, copyAheadType: 'draft-mtp; rm -rf' }).join(' ') === '--spec-type ngram-simple', 'an unknown type falls back to the safe default (config text never reaches the command line)');
ok(tuningArgs({ kvCache: 'q4_0' }).length === 0, 'unsupported KV types are ignored');

// CPU low-memory mode (no weight repacking)
const { commitNeed } = require(ROOT + '/tuning.js');
ok(tuningArgs({}, 'cpu').join(' ') === '--no-repack', 'CPU engine: low-memory mode (no repacking) is on by default');
ok(tuningArgs({ cpuLowMemory: false }, 'cpu').length === 0, 'CPU engine: low-memory mode can be turned off');
ok(!tuningArgs({}, 'vulkan').includes('--no-repack'), 'GPU engine: never gets the CPU-only flag');
ok(commitNeed(15e9, 'cpu', {}, true) === 4e9 && commitNeed(15e9, 'vulkan', {}, true) > 20e9 && commitNeed(15e9, 'cpu', { cpuLowMemory: false }, false) > 19e9,
  'memory check: CPU low-memory mode needs only working buffers; GPU and CPU-with-repack still need about the model size');
