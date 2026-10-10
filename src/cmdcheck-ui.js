// Command checker, page side: after an answer finishes, its PowerShell is checked against this PC (cmdcheck.js in the main
// process). Problems get a red wavy underline in the code and a note under the answer, with a button that drafts a
// correction request containing the command's REAL parameters. Everything here is built with textContent.
const CC_SCOPE = 'Checked: that each command and parameter exists on this PC. Not checked: whether it does what the answer says, the values, or whether it is safe to run.';

// meta: {question, model, shownIds} lets the main process log caught mistakes (see ledger.js).
async function checkCommandsIn(root, box, answer, meta = {}) {
  if (config?.checkCommands === false || !/[A-Za-z]-[A-Za-z]|```/.test(answer)) return;
  let r;
  try { r = await openport.cmdcheck.check(answer, meta); } catch (e) { r = { error: e.message }; }
  if (!r || (!r.error && !r.checked && !r.notInstalled)) return;           // no PowerShell in this answer
  box.replaceChildren();
  box.className = 'cmdnote';
  if (r.error) { box.textContent = `Command check could not run: ${r.error}`; return; }
  const shell = r.ps ? `Windows PowerShell ${r.ps.split('.').slice(0, 2).join('.')}` : 'PowerShell';
  const once = list => [...new Map(list.map(x => [x.message, x])).values()];      // same problem shown twice in an answer: list it once
  const problems = once(r.results.filter(x => x.status === 'unknown-command' || x.status === 'bad-params'));
  const notInstalled = once(r.results.filter(x => x.status === 'not-installed'));
  markCommandProblems(root, [...problems, ...notInstalled]);
  clearProvenUnsure(root, r.results);

  const head = document.createElement('div');
  head.className = 'cmd-head';
  head.title = CC_SCOPE;
  if (!problems.length) {
    box.classList.add('ok');
    head.textContent = `✓ ${r.checked} command${r.checked === 1 ? '' : 's'} checked: every name and parameter exists on this PC (${shell}).`;
  } else {
    box.classList.add('bad');
    head.textContent = `✗ ${problems.length} command${problems.length === 1 ? '' : 's'} won't work as written on this PC (${shell}):`;
  }
  box.append(head);
  const list = document.createElement('ul');
  for (const x of [...problems, ...notInstalled]) {
    const li = document.createElement('li');
    li.className = x.status === 'not-installed' ? 'unverified' : 'problem';
    li.textContent = x.message;
    list.append(li);
  }
  if (list.children.length) box.append(list);
  const foot = document.createElement('div');
  foot.className = 'cmd-foot';
  const scope = document.createElement('span');
  scope.textContent = 'Checks names only, not what the command does.' + (r.logged ? ` Saved ${r.logged} verified fact${r.logged === 1 ? '' : 's'} to the mistake log (Memory).` : '');
  scope.title = CC_SCOPE;
  foot.append(scope);
  if (problems.length) {
    const fix = document.createElement('button');
    fix.type = 'button'; fix.className = 'small'; fix.textContent = 'Ask it to fix these';
    fix.title = 'Writes a correction request (with the real parameter lists from this PC) into the message box. You press Send.';
    fix.onclick = () => {
      els.input.value = fixRequest(problems);
      els.input.dispatchEvent(new Event('input'));
      els.input.focus();
    };
    foot.append(fix);
  }
  box.append(foot);
}

// The confidence underline says "the model was unsure about this word". When that word is a command or parameter the checker
// just proved exists on this PC, the doubt is settled: the underline turns into a quiet "checked" mark, and the note says so.
function clearProvenUnsure(root, results) {
  const proven = new Set();
  for (const x of results) {
    if (x.status === 'ok' || x.status === 'bad-params') {
      if (x.status === 'ok') { proven.add(x.name.toLowerCase()); if (x.resolved) proven.add(x.resolved.toLowerCase()); }
      const bad = new Set((x.bad || []).map(b => b.param.toLowerCase()));
      for (const p of x.params || []) if (!bad.has(p.raw.toLowerCase())) proven.add(p.raw.toLowerCase());
    }
  }
  let cleared = 0;
  for (const s of root.querySelectorAll('.unsure')) {
    const word = s.textContent.trim().toLowerCase();
    if (!proven.has(word)) continue;
    s.className = 'unsure-cleared';
    s.title = 'The model was unsure about this word, but the command check confirmed it exists on this PC.';
    cleared++;
  }
  if (!cleared) return;
  const note = root.parentElement?.querySelector('.confnote');
  if (!note) return;
  const left = root.querySelectorAll('.unsure').length;
  note.className = 'confnote' + (left ? ' warn' : '');
  note.textContent = left
    ? `⚠ ${left} value${left > 1 ? 's' : ''} the model was unsure about. Hover the wavy underline to see why. (${cleared} more ${cleared > 1 ? 'were command names' : 'was a command name'} the command check confirmed.)`
    : `✓ The model was unsure about ${cleared} command name${cleared > 1 ? 's' : ''}, but the command check confirmed ${cleared > 1 ? 'they exist' : 'it exists'} on this PC.`;
}

// The correction request: what is wrong, plus ground truth (real parameter names) so the model can't guess again.
function fixRequest(problems) {
  const lines = ['The command checker on my PC found problems in your PowerShell:'];
  for (const x of problems) {
    let l = `- ${x.message}`;
    if (x.valid?.length) l += `. The real parameters of ${x.resolved || x.name} are: ${x.valid.join(', ')}`;
    lines.push(l);
  }
  lines.push('', 'Please correct the commands. Use only commands and parameters that exist; if something needs a module I don\'t have, say so.');
  return lines.join('\n');
}

// Red wavy underline on the wrong command names / parameters inside the answer's code.
function markCommandProblems(root, items) {
  const targets = [];
  for (const x of items) {
    const tip = x.message;
    if (x.status === 'bad-params') for (const b of x.bad) targets.push({ token: b.param, tip, cls: 'cmd-bad' });
    else targets.push({ token: x.name, tip, cls: x.status === 'not-installed' ? 'cmd-unverified' : 'cmd-bad' });
  }
  if (!targets.length) return;
  const codes = root.querySelectorAll('code');
  for (const code of codes) {
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n; (n = walker.nextNode());) if (!n.parentElement.closest('.copy, .code-head, .cmd-bad, .cmd-unverified')) nodes.push(n);
    for (const node of nodes) {
      // Every occurrence of every problem token in this text node, then wrap them from the end so offsets stay valid.
      const hits = [];
      for (const t of targets) {
        const esc = t.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(^|[\\s|;({\`=])(${esc})(?=$|[\\s|;)}:,])`, 'gi');
        for (const m of node.nodeValue.matchAll(re)) hits.push({ start: m.index + m[1].length, len: m[2].length, t });
      }
      hits.sort((a, b) => b.start - a.start);
      let lastStart = Infinity;
      for (const h of hits) {
        if (h.start + h.len > lastStart) continue;          // overlapping match: keep the later one
        const mid = node.splitText(h.start);
        mid.splitText(h.len);
        const span = document.createElement('span');
        span.className = h.t.cls; span.title = h.t.tip;
        mid.replaceWith(span);
        span.append(mid);
        lastStart = h.start;
      }
    }
  }
}
