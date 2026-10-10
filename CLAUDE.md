# OpenPort: guide for AI coding assistants (and humans) working in this repo

OpenPort is a **portable, private chat app for local open-source models**. It is an Electron desktop app (Windows only) that
runs `llama.cpp` (`llama-server.exe`) on your own machine. Chat history, files and (optionally) screen text never leave the
computer. It is built for IT work: troubleshooting, configs, logs, PowerShell. The guiding idea is **"verify, don't trust"**:
the model writes, and the app checks what it wrote against facts it can prove (your files, this PC's real PowerShell, the
real services on the machine) without ever rewriting the answer itself.

Privacy and honesty about what is and is not verified matter more than feature count.

Two editions come from one codebase: **home** (everything, including opt-in screen memory and online model downloads) and
**work** (`scripts\make-portable.ps1 -WorkEdition`: CPU engine, no screen memory, approved model publishers only).

## Commands (run from this folder)

| Command | What it does |
|---|---|
| `npm start` or double-click `Launch OpenPort.bat` | Starts the real app. **It loads the chat model (5–15 GB)**: don't do this for UI work. |
| `npm run preview` | UI-only preview at http://127.0.0.1:5599/ with a stand-in backend (`tests/ui-preview.js`). No model, no engine. Add `?work` for the work edition. **Use this for all UI work.** |
| `npm run check` | Static safety checks (syntax, every element id used by scripts exists in the HTML, CSP rules, no internet assets, no garbled emoji). **Run after every UI change.** |
| `npm run shots` | With the preview running: full-size PNGs of the start screen, a chat, every dialog, light/dark, 640 px wide and `?work`, saved to `ui-screenshots\` (`tests/ui-screenshots.js`; `SHOTS=03,16` re-takes some). Loads Electron only, no model. |
| `npm test` | ~300 logic checks (prompt planner, command checker, edit check, mistake log, claim checks incl. live read-only lookups on this PC, memory ranking, scrubbing, screen-memory policy, engine tuning flags, config reading, log triage...). No model needed. |
| `node eval\bench-speed.js --yes` | Speed / memory / quality shootout of every installed model on GPU and CPU, with and without the tuning options. **Loads every model in turn: ask first.** |
| `npm run pack` / `scripts\make-portable.ps1 -Target E:\OpenPort` | Build / assemble the portable folder. Not yet test-run end to end. |

Models (`models\`) and the engine (`engine\`) are not in the repo: `scripts\fetch-engine.ps1` and `scripts\fetch-model.ps1`
download them, or use the Models dialog in the app.

## How OpenPort checks the model's work (the "verify, don't trust" layer)

All of these are deterministic code, run after an answer is written, shown to the user, and never sent back to the model
unless the user asks. They only ADD facts the machine proved; they never rewrite an answer or tell the model which fix is
right (a forced "correction" can itself be wrong).

| Check | What it does | Code |
|---|---|---|
| **Command checker** | Finds every PowerShell command and parameter in an answer and looks it up in this PC's own PowerShell (`Get-Command`). Invented cmdlets (`Get-NetAdapterStats`) and parameters (`-Recursive`) get a red underline and a "did you mean"; "Ask it to fix these" drafts a correction containing the real parameter list. Only names are looked up; nothing from the answer is run. | `cmdcheck.js`, `pscatalog.js`, `src/cmdcheck-ui.js` |
| **Mistake log** | Every caught mistake becomes a fact this PC proved ("Get-ChildItem has no -Recursive; its real parameters are ..."), shown to the model on related questions, re-checked before use, and counted ("repeated even after being shown"). | `ledger.js`, `db.js` (`cmd_ledger`) |
| **Claim checks** | Statements about this PC (service status, installed KB updates, local paths) are checked read-only; IPs, VLANs, interfaces and MACs are checked against the files in the chat. Labels: matches / different here / not found / info. | `src/claims.js`, `claimprobe.js` |
| **Edit check** | When an answer returns a file, config or earlier answer with changes, it is compared line by line: only the changed lines are highlighted (hover shows the original), and lines that **silently disappeared** are listed. Compares with attached files, files read by tools, and the last 3 answers in the chat. | `src/provenance.js`, `src/provenance-ui.js` |
| **Copy score** | With copy-ahead on, the engine reports how many of its "copy from the prompt" guesses were accepted: the share of the answer copied word for word. A hint (it undercounts), not a check. | `copyScoreText` in `src/provenance-ui.js` |
| **Confidence underlines** | Values the model was unsure about (token probabilities) get a wavy underline; if the command checker proves a name exists, the doubt is cleared. Not available while the model has tools (llama.cpp limitation, see below). | `src/confidence.js` |
| **"Why this answer?"** | Re-runs the question with each source left out and shows what the answer depended on. | `src/attrib.js` |

## Engine tuning (Settings → Engine, `tuning.js`)

Measured with `eval\bench-speed.js` and `eval\bench-cpu-memory.js` on a Ryzen 7 7800X3D / Radeon RX 7800 XT 16 GB / 32 GB RAM,
llama.cpp build 11457, Gemma 4 26B-A4B (Q4_K_XL), 2026-10-09:

| Setup | Normal chat | "Fix this config and return it" | Notes |
|---|---|---|---|
| 26B-A4B, GPU | 109 tok/s | 64 tok/s | 12/12 starter tests, 13.8 GB VRAM |
| + copy-ahead (`--spec-type ngram-simple`) | 109 | **396** (86% of drafts accepted) | output byte-identical; `ngram-mod` reached 204 |
| + 8-bit KV cache (`-fa on -ctk q8_0 -ctv q8_0`) | 112 | 80 | output identical, 12/12 |
| 12B dense, GPU | 66 | 61 | 12/12 |
| 26B-A4B, CPU (6 threads) | 20.6 | 18.2 → **44.2** with copy-ahead | output identical |
| 12B dense, CPU | 7.7 | – | the MoE (4B active) is 2.7x faster than a dense 12B on CPU |

- **Copy-ahead** (n-gram lookup speculative decoding): the engine copies likely next words from the prompt and the model
  only verifies them. No extra model, identical output with greedy decoding, big wins on "edit and return" tasks. Off by
  default until verified alongside tools/streaming in the running app.
- **CPU low-memory mode** (`--no-repack`, on by default for the CPU engine): 26B RAM 23.4 → 13.9 GB, load 13 → 3 s, same
  writing speed, prompt reading 85 → 61 tok/s. The memory guard (`tuning.commitNeed`) knows this mode reserves little.
- **8-bit KV cache**: small speed-up, identical answers here; saves little memory at 8K context with Gemma 4.

## Files

- `main.js`: Electron main process: window, engine start/stop, every IPC handler, tray, hotkeys, config (`data\config.json`).
- `preload.js`: the **only** bridge: exposes `window.openport.*` to the page. If you add a backend call, add it here **and** to the stand-in in `tests/ui-preview.js`.
- `src/`: the whole interface. `index.html` (all markup, all dialogs), `styles.css`, and plain scripts sharing one global scope: `promptplan.js`, `confidence.js`, `attrib.js`, `memfacts.js`, `app.js` (chat, settings, streaming), `ctxmap.js`, `models-ui.js`, `tests-ui.js`, `cart-ui.js`, `screen-ui.js`, `memory-ui.js`, `cmdcheck-ui.js`, `provenance.js` + `provenance-ui.js`, `claims.js` + `claims-ui.js`, `layout.js`, `resmeter.js`.
- Backend modules: `db.js` (SQLite: chats, memory vectors, facts, mistake log, folder index, screen moments), `memrank.js` (time-aware recall), `cmdcheck.js` + `pscatalog.js`, `ledger.js`, `claimprobe.js`, `tuning.js`, `sysstats.js` (RAM/VRAM meter), `embed.js` (EmbeddingGemma 2), `tools.js` + `netconfig.js` + `logtriage.js` (tools the model can call), `screenmem.js` + `scrub.js` + `screenhelper.js` + `screencapture.js` + `native/screen-helper.ps1` (screen memory), `evals.js` (model tests), `hf.js` + `models.js` (model manager), `audit.js`.
- Data lives next to the app and is git-ignored: `data\` (chats.db, config.json, audit.log, cartridges, bench results), `models\`, `engine\`. The `OPENPORT_DATA` env var points tests at a throwaway data folder.

## The interface

Clean macOS-like style: system font stack, design tokens on `:root`, grouped settings cards, switches on `.check` checkboxes,
segmented tabs, inline SVG icons (`class="i"`). Screenshots: `ui-screenshots\`.
Sidebar: brand, New chat, chat search, chat list, model card (dropdown + status + Load/Unload), the red screen-memory pill
(home, only when on), nav: Models, Model tests, Memory, Cartridges, Screen timeline (home), Settings. At ≤760 px the sidebar is a
slide-over drawer (`body.side-open`, `#scrim`); above that `#side-toggle` collapses it.
Main area: top bar (`#side-toggle`, `#top-title`, `#res-meter` RAM/VRAM, "On this device"), messages (answers with notes for each
check below them), starter chips on the empty screen, `#banner`, the composer card, `#ctx-meter`.
Dialogs (`<dialog>`): settings, models, model tests, memory (incl. mistake log), cartridges, screen timeline, context map, activity log.

## HARD RULES for any interface change

1. **Content-Security-Policy is strict** (`index.html` `<meta>`): `script-src 'self'; style-src 'self'; connect-src http://127.0.0.1:*`. So: **no inline `<script>`, no `style="..."` attributes, no `onclick=""` handlers, no CDN/web fonts/icon fonts/images from the internet, no `eval`**. Setting `element.style.x = ...` from JavaScript is allowed. Fonts and icons must be local files inside `src/` (the app blocks all non-local network requests, and the work edition must run with no internet). `npm run check` enforces this.
2. **Element ids are an API.** The scripts find elements by id (`$('send')`, `S('s-sm-on')`...). Renaming or deleting an id breaks features silently. Restyle freely, but keep every id (or change the script and the HTML together) and run `npm run check`.
3. **Never put untrusted text into `innerHTML`.** Model answers, file contents, OCR text, window titles and Hugging Face results are untrusted: use `textContent` / DOM building. Markdown goes through `marked` + `DOMPurify` only.
4. **Keep the privacy safeguards visible.** Screen memory always shows its recording indicator (sidebar pill + tray); deletion actions keep their confirmation; the "OCR can misread characters" and "double-check this value" warnings stay. The work edition hides all screen-memory UI (`allowScreenMemory: false`) and that must keep working (`/?work` in the preview).
5. **Light and dark themes** both work via CSS variables and `prefers-color-scheme`. Keep both. Must stay usable at about 650 px wide and on a laptop screen.
6. **No heavy frameworks or build steps** unless clearly worth it: vanilla JS, loads offline, packaged with `asar: false`. If you add a library, vendor it locally (see `scripts/copy-vendor.js`) and keep the CSP unchanged.
7. Don't rename IPC channels or `window.openport` functions without updating `preload.js`, `main.js` and the stand-in in `tests/ui-preview.js`.

## How to verify a change (no model needed)

1. `npm run preview`, open http://127.0.0.1:5599/, look at the sidebar, a chat, **every dialog** (Settings is long: scroll it), and `/?work`.
2. In the browser console the scripts share one global scope: e.g. `config = await openport.getConfig(); await openSettings();`, `renderMap()`, `openTests()`. The stand-in returns canned data (the command checker and claim probes call the real read-only lookups through the preview server).
3. `npm run check` and `npm test` must pass. Then say clearly what you saw and what you could not check.

## Working rules

- **Ask before loading models.** Don't run the chat model, `eval\*.js --yes` scripts, or any sustained CPU/GPU load without asking the person you're working with, and say exactly what will load: they use 5–15 GB and stress the machine. UI work needs none of that.
- **Report honestly**: what was tested, how, and what was not. Don't claim a feature works on the real engine unless it was run there.
- **Never read, print or store real screen content, chats or files while testing.** Use the preview, synthetic data, or `OPENPORT_DATA=<temp folder>`.
- Windows PowerShell 5.1: `Set-Content -Encoding UTF8` writes a BOM (the app tolerates it; write JSON with `[System.IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding($false)))`). `powershell -Command -` reads stdin like typed input: send multi-line scripts as one block followed by an empty line (see `pscatalog.js`).

## Known limitations and gaps (don't pretend otherwise)

- **llama.cpp rejects `logprobs` together with `tools` + `stream`** (HTTP 400). The app never sends both: confidence underlines are skipped for answers made with tools attached (file tools, `check_this_pc`, or screen-memory search; that one stays attached while recording is *paused*), and the note names the exact tool and its switch.
- **Run on the real model so far:** command checker, claim checks, confidence underlines, screen memory ("what website was I on?"), service listing, the RAM/VRAM meter, and every row of the tuning table above (via `eval\bench-speed.js`).
- **Not yet run on the real model / in the running app:** copy-ahead and CPU low-memory mode inside the app (only via the benchmark with the same flags), the edit check and copy score on real answers, "Why this answer?", cartridges, type-ahead, "Suggest facts from this chat", the packaged build, and anything on a work laptop (endpoint security or Constrained Language Mode may block the PowerShell lookups).
- **Untuned guesses:** memory "same topic" threshold 0.88, recency bonus, recall "stands out" margin 0.06, mistake-log "similar question" threshold 0.62.
- The command checker knows Windows PowerShell 5.1 only (PowerShell 7-only commands would be reported as missing).
