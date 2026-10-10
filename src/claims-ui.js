// Claim checks, page side: after an answer, statements that can be checked against this PC (services, installed updates,
// local paths) or against the files in this conversation (IPs, VLANs, interfaces, MACs) get a label and an underline.
// Results are shown to you only; they are not sent to the model. All text is set with textContent.
const CL_BADGE = { match: '✓', differs: '≠', absent: '?', info: 'i' };
const CL_WORD = { match: 'Matches', differs: 'Different here', absent: 'Not found', info: 'This PC' };

// meta: {question, sources:[{name, text}]}
async function checkClaimsIn(root, box, answer, meta = {}) {
  if (config?.checkClaims === false || !window.Claims) return;
  const probeReq = Claims.toProbe(answer);
  const wantsProbe = probeReq.services.length || probeReq.kbs.length || probeReq.paths.length;
  const valueItems = Claims.checkValues(answer, meta.sources || [], meta.question || '');
  if (!wantsProbe && !valueItems.length) return;
  let items = [...valueItems], err = null;
  if (wantsProbe) {
    try {
      const facts = await openport.claims.probe(probeReq);
      if (facts?.error) err = facts.error;
      else if (facts) items = [...Claims.judgeAll(probeReq, facts, meta.question || ''), ...items];
    } catch (e) { err = e.message; }
  }
  if (!items.length && !err) return;
  render();

  function render() {
    box.replaceChildren();
    box.className = 'claimnote';
    const head = document.createElement('div');
    head.className = 'cl-head';
    const differs = items.filter(i => i.label === 'differs').length, absent = items.filter(i => i.label === 'absent').length;
    head.textContent = differs ? `≠ ${differs} statement${differs === 1 ? ' in this answer doesn\'t' : 's in this answer don\'t'} match this PC or your files`
      : absent ? `Checked ${items.length} statement${items.length === 1 ? '' : 's'} against this PC and your files: ${absent} couldn't be found`
      : `✓ Checked ${items.length} statement${items.length === 1 ? '' : 's'} against this PC and your files`;
    if (differs) box.classList.add('bad'); else if (!absent) box.classList.add('ok');
    box.append(head);
    const order = { differs: 0, absent: 1, match: 2, info: 3 };
    const list = document.createElement('ul');
    const sorted = [...items].sort((a, b) => order[a.label] - order[b.label]);
    sorted.slice(0, 12).forEach(i => {
      const li = document.createElement('li');
      const b = document.createElement('span');
      b.className = `cl-badge ${i.label}`; b.textContent = CL_BADGE[i.label]; b.title = CL_WORD[i.label];
      const t = document.createElement('span');
      t.textContent = i.text;
      li.append(b, t);
      list.append(li);
    });
    if (sorted.length > 12) { const li = document.createElement('li'); li.className = 'more'; li.textContent = `…and ${sorted.length - 12} more`; list.append(li); }
    box.append(list);
    const foot = document.createElement('div');
    foot.className = 'cl-foot';
    foot.textContent = (err ? `Some checks could not run (${err}). ` : '') +
      'These describe THIS computer and the files in this chat. If the answer is about another machine, they don\'t apply. Not sent to the model.';
    box.append(foot);
    const marks = items.filter(i => i.label !== 'info');
    markMentions(root, [...marks, ...marks.flatMap(i => (i.alsoMentions || []).map(m => ({ ...i, mention: m })))]);
  }
}

// Underlines each mention in the answer (prose and code), coloured by its label, with the finding as a tooltip.
function markMentions(root, items) {
  if (!items.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement.closest('.copy, .code-head, .claim-mark, .cmd-bad, .cmd-unverified') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  for (let n; (n = walker.nextNode());) nodes.push(n);
  for (const node of nodes) {
    const hits = [];
    for (const it of items) {
      const esc = it.mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^\\w.\\\\])(${esc})(?![\\w\\\\])`, 'gi');
      for (const m of node.nodeValue.matchAll(re)) hits.push({ start: m.index + m[1].length, len: m[2].length, it });
    }
    // Where two mentions overlap ("Print Spooler" and "Spooler"), the longer one wins; then wrap from the end.
    const picked = [];
    for (const h of hits.sort((a, b) => b.len - a.len)) {
      if (!picked.some(p => h.start < p.start + p.len && p.start < h.start + h.len)) picked.push(h);
    }
    picked.sort((a, b) => b.start - a.start);
    for (const h of picked) {
      const mid = node.splitText(h.start);
      mid.splitText(h.len);
      const span = document.createElement('span');
      span.className = `claim-mark ${h.it.label}`; span.title = h.it.text;
      mid.replaceWith(span);
      span.append(mid);
    }
  }
}
