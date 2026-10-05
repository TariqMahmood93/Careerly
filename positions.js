/* Careerly: "All open positions" browser.
 * Shows every open call collected daily from Bandi MUR, EURAXESS and jobs.ac.uk
 * (data/positions.json, built by scripts/fetch_positions.py in GitHub Actions),
 * with filters for country, source, type and relevance to the profile.
 *
 * Personal matching: any visitor can upload their own CV. Its text is read in the browser,
 * turned into weighted topic terms (rarer terms count more), and every position is re-scored
 * against them. The CV and terms are kept only in this browser's storage, never uploaded.
 */
(() => {
  'use strict';

  const URL = 'data/positions.json';
  const PREFS_KEY = 'careerly.browse.v1';
  const PAGE = 10;
  const C = window.Careerly;
  const { esc, fmtDate, daysFromToday, todayISO } = C;
  const $ = sel => document.querySelector(sel);

  let all = [];
  let meta = {};
  let shown = PAGE;
  const PERSONAL_KEY = 'careerly.personalMatch.v1';
  let personal = null; // { name, terms: [{ t, w, custom? }], savedAt }

  // ---------- personal matching ----------
  const STOP = new Set(`a about above after again all also am an and any are as at be because been before being below
    between both but by can could did do does doing down during each few for from further had has have having he her
    here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other
    our out over own same she should so some such than that the their them then there these they this those through to
    too under until up very was we were what when where which while who whom why will with would you your
    via per etc using used based new within across including include includes towards toward well e.g i.e
    il lo la i gli le un una uno di da del della dei degli delle al alla ai agli alle dal dalla nel nella nei nelle sul
    sulla con per tra fra che non come anche piu sono essere stato ed o se su ad questo questa
    university universita universite department dipartimento faculty school institute istituto centre center lab
    laboratory group research ricerca researcher researchers phd dottorato doctoral postdoc postdoctoral post doc
    professor prof dr assistant associate fellow fellowship position positions project projects work working year years
    month months email phone tel mobile address italy pakistan january february march april may june july august
    september october november december present current cv curriculum vitae page pages vol pp doi http https www com org
    pdf grade supervisor co supervisor thesis master msc bsc mphil degree degrees bachelor student students course
    courses member editor reviewer review journal journals conference conferences proceedings workshop workshops
    paper papers international national european europe skills languages language english native professional
    references reference declaration hereby information true correct knowledge belief personal data
    big small novel approach approaches method methods analysis development design system systems model models tool tools
    application applications technique techniques experience expertise industry company based study studies topic topics
    activity activities team teams level high low good excellent strong main key general specific various several
    app apps internet things introduction extended grant grants award awards abstract abstracts pre aware dynamic
    accuracy incomplete free available anyone without own non one two three first second third free freely open
    title titles volume issue under preparation submitted accepted stage experimental experiments seminar seminars
    certificate certificates certification certifications coursework training`.split(/\s+/));

  function norm(str) {
    return ' ' + (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }

  function cvCandidates(text) {
    const words = norm(text).trim().split(' ');
    const tf = new Map();
    const bump = t => tf.set(t, (tf.get(t) || 0) + 1);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const ok = w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w);
      if (ok) bump(w);
      const n = words[i + 1];
      if (ok && n && n.length >= 2 && !STOP.has(n) && !/^\d+$/.test(n)) bump(`${w} ${n}`);
    }
    return tf;
  }

  function posText(p) {
    if (!p._norm) {
      p._norm = norm([p.title, p.titleAlt, p.field, p.summary, p.kind, (p.matched || []).join(' ')].join(' '));
    }
    return p._norm;
  }

  function buildTerms(text) {
    const tf = cvCandidates(text);
    const N = all.length || 1;
    const scored = [];
    for (const [t, n] of tf) {
      let df = 0;
      const needle = ` ${t} `;
      for (const p of all) if (posText(p).includes(needle)) df++;
      if (df === 0 || df > N * 0.2) continue; // never appears, or too common to be useful
      const bigram = t.includes(' ');
      if (!bigram && n < 2 && t.length < 6) continue; // one-off short words are noise
      const w = (1 + Math.log(n)) * Math.log(N / df) * (bigram ? 1.4 : 1);
      scored.push({ t, w: Math.round(w * 100) / 100 });
    }
    scored.sort((a, b) => b.w - a.w);
    // drop single words already covered by a stronger phrase containing them
    const out = [];
    for (const x of scored) {
      if (!x.t.includes(' ') && out.some(y => y.t.includes(' ') && y.t.split(' ').includes(x.t) && y.w >= x.w)) continue;
      out.push(x);
      if (out.length >= 40) break;
    }
    return out;
  }

  function applyPersonal() {
    for (const p of all) { delete p._ps; delete p._prel; delete p._phits; }
    if (!personal || !personal.terms.length) return;
    let max = 0;
    for (const p of all) {
      const txt = posText(p);
      let sc = 0;
      const hits = [];
      for (const { t, w } of personal.terms) {
        if (txt.includes(` ${norm(t).trim()} `)) { sc += w; hits.push(t); }
      }
      p._ps = Math.round(sc * 10) / 10;
      p._phits = hits;
      if (sc > max) max = sc;
    }
    for (const p of all) p._prel = p._phits.length >= 2 && p._ps >= max * 0.2;
  }

  const isPersonal = () => !!(personal && personal.terms.length);
  const relOf = p => (isPersonal() ? p._prel : p.relevant);
  const scoreOf = p => (isPersonal() ? p._ps : p.score);
  const hitsOf = p => (isPersonal() ? p._phits : p.matched) || [];

  function loadPersonal() {
    try { personal = JSON.parse(localStorage.getItem(PERSONAL_KEY) || 'null'); } catch { personal = null; }
  }
  const personalListeners = [];
  function savePersonal({ silent = false } = {}) {
    try {
      if (personal) localStorage.setItem(PERSONAL_KEY, JSON.stringify(personal));
      else localStorage.removeItem(PERSONAL_KEY);
    } catch { /* storage unavailable: matching still works for this visit */ }
    if (!silent) personalListeners.forEach(fn => { try { fn(personal); } catch { /* ignore */ } });
  }

  function renderMatchBar() {
    const on = isPersonal();
    $('#match-upload-label').firstChild.textContent = on ? `📄 Matching: ${personal.name || 'my CV'} (replace) ` : '📄 Match to my CV ';
    $('#match-clear').hidden = !on;
    $('#match-terms').hidden = !on;
    $('#br-rel-label').lastChild.textContent = on ? ' Only matching my CV' : ' Only matching the profile';
    if (on) {
      $('#match-chips').innerHTML = personal.terms.map((x, i) =>
        `<span class="chip term${x.custom ? ' custom' : ''}" title="weight ${x.w}">${esc(x.t)}<button type="button" data-rm-term="${i}" aria-label="Remove">✕</button></span>`).join('');
    }
  }

  const prefs = (() => {
    try { return { relevant: true, sort: 'deadline', ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; }
    catch { return { relevant: true, sort: 'deadline' }; }
  })();
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }

  // Claude's daily hand-picked calls (data/suggestions.json) join the same list as "Claude picks"
  function pickToPosition(x) {
    return {
      id: `pick-${x.id}`, pick: true, source: 'Claude daily pick', origin: x.source || '',
      kind: x.type || '', type: x.type || '', title: x.title, titleAlt: '',
      institution: [x.institution, x.pi].filter(Boolean).join(' · '),
      country: x.country || '', city: x.city || '', deadline: x.deadline || '',
      url: x.callUrl || x.applyUrl || '', applyUrl: x.applyUrl || '',
      field: x.keywords || '', summary: x.procedure || '', why: x.why || '',
      salary: x.salary || '', duration: x.duration || '',
      score: 100 + (Number(x.matchScore) || 0), stars: Number(x.matchScore) || 0,
      matched: [], relevant: true, firstSeen: x.foundOn || '', raw: x,
    };
  }

  async function getJson(url) {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  async function load() {
    const [data, picks] = await Promise.all([getJson(URL), getJson('data/suggestions.json')]);
    if (!data && !picks) return; // no data yet, or opened as a local file
    const open = p => !p.deadline || daysFromToday(p.deadline) >= 0;
    const pickList = ((picks && picks.suggestions) || []).filter(x => x && x.id && x.title).map(pickToPosition).filter(open);
    const pickUrls = new Set(pickList.map(p => p.url).filter(Boolean));
    // a call found both ways is shown once, as the Claude pick (it has the "why it matches" note)
    const collected = ((data && data.positions) || []).filter(open).filter(p => !pickUrls.has(p.url));
    all = [...pickList, ...collected];
    meta = { ...(data || {}), picksUpdatedAt: picks && picks.updatedAt };
    if (meta.sources && pickList.length) meta.sources = { 'Claude daily picks': { ok: true, count: pickList.length }, ...meta.sources };
    $('#browse').hidden = false;
    loadPersonal();
    applyPersonal();
    restoreControls();
    renderMatchBar();
    render();
  }

  function restoreControls() {
    $('#br-relevant').checked = prefs.relevant !== false;
    $('#br-sort').value = prefs.sort || 'deadline';
    $('#br-search').value = prefs.q || '';
  }

  function optionList(sel, values, allLabel, current) {
    const counts = {};
    values.forEach(v => { if (v) counts[v] = (counts[v] || 0) + 1; });
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    sel.innerHTML = `<option value="">${esc(allLabel)} (${values.length})</option>` +
      keys.map(k => `<option value="${esc(k)}">${esc(k)} (${counts[k]})</option>`).join('');
    sel.value = keys.includes(current) ? current : '';
    return sel.value;
  }

  function filtered() {
    const q = ($('#br-search').value || '').trim().toLowerCase();
    let list = prefs.relevant ? all.filter(relOf) : all;
    if (q) {
      const terms = q.split(/\s+/);
      list = list.filter(p => {
        const hay = [p.title, p.titleAlt, p.institution, p.city, p.country, p.field, p.summary, p.kind, hitsOf(p).join(' ')]
          .join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    // facet dropdowns reflect the current relevance + search filter
    prefs.country = optionList($('#br-country'), list.map(p => p.country || 'Other'), '🌍 All countries', prefs.country);
    const byCountry = prefs.country ? list.filter(p => (p.country || 'Other') === prefs.country) : list;
    prefs.source = optionList($('#br-source'), byCountry.map(p => p.source), 'All sources', prefs.source);
    const bySource = prefs.source ? byCountry.filter(p => p.source === prefs.source) : byCountry;
    prefs.type = optionList($('#br-type'), bySource.map(p => p.kind || p.type), 'All position types', prefs.type);
    list = prefs.type ? bySource.filter(p => (p.kind || p.type) === prefs.type) : bySource;

    const far = '9999-12-31';
    const sorters = {
      deadline: (a, b) => (a.deadline || far).localeCompare(b.deadline || far),
      newest: (a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || '') || (scoreOf(b) - scoreOf(a)),
      match: (a, b) => scoreOf(b) - scoreOf(a) || (a.deadline || far).localeCompare(b.deadline || far),
    };
    return list.slice().sort(sorters[prefs.sort] || sorters.deadline);
  }

  function deadlineChip(d) {
    if (!d) return '<span class="chip">⏰ no deadline stated</span>';
    const days = daysFromToday(d);
    const cls = days <= 3 ? 'overdue' : days <= 10 ? 'due-soon' : '';
    const left = days === 0 ? ' (today!)' : days <= 10 ? ` (${days}d left)` : '';
    return `<span class="chip ${cls}">⏰ ${esc(fmtDate(d))}${left}</span>`;
  }

  function render() {
    const list = filtered();
    const tracked = C.tracked();
    const today = todayISO();
    const relevantCount = all.filter(relOf).length;
    const newToday = list.filter(p => p.firstSeen === today).length;
    $('#br-summary').innerHTML =
      `<strong>${list.length}</strong> shown · ${all.length} open calls in total, ${relevantCount} match ${isPersonal() ? 'your CV' : 'the profile'}` +
      (newToday ? ` · <strong>${newToday} new today</strong>` : '') +
      (meta.updatedAt ? ` · updated ${esc(new Date(meta.updatedAt).toLocaleString())}` : '') +
      (meta.picksUpdatedAt ? ` · Claude's last search ${esc(new Date(meta.picksUpdatedAt).toLocaleString())}` : '');
    const srcInfo = Object.entries(meta.sources || {})
      .map(([name, s]) => `${esc(name)}: ${s.ok === false ? '⚠️ failed, showing previous data' : (s.count ?? '?')}`).join(' · ');
    $('#br-sources').textContent = srcInfo ? `Sources — ${srcInfo}` : '';

    $('#br-list').innerHTML = list.slice(0, shown).map(p => {
      const inTracker = tracked.ids.has(p.id) || tracked.urls.has(p.url);
      const loc = [p.city, p.country].filter(Boolean).join(', ');
      return `<article class="br-item">
        <div class="br-main">
          <h3>${p.pick ? '<span class="chip pick" title="Hand-picked by Claude\'s daily search for the site owner">⭐ Claude pick</span> ' : ''}<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>
            ${p.firstSeen === today ? '<span class="chip new">NEW</span>' : ''}</h3>
          ${p.titleAlt ? `<div class="muted br-alt">${esc(p.titleAlt)}</div>` : ''}
          <div class="inst">${esc(p.institution || '')}</div>
          <div class="meta">
            ${loc ? `<span class="chip">📍 ${esc(loc)}</span>` : ''}
            ${deadlineChip(p.deadline)}
            ${p.stars ? `<span class="chip" title="Match with the owner's profile">${'★'.repeat(Math.min(5, p.stars))}</span>` : ''}
            <span class="chip">🔎 ${esc(p.pick ? (p.origin || 'Claude search') : p.source)}</span>
            ${p.kind || p.type ? `<span class="chip">${esc(p.kind || p.type)}</span>` : ''}
            ${hitsOf(p).slice(0, 4).map(m => `<span class="chip kw">${esc(m)}</span>`).join('')}
          </div>
          ${p.why ? `<p class="why">💡 ${esc(p.why)}</p>` : ''}
          ${p.summary || p.field ? `<details><summary>Details</summary>
            ${p.field ? `<p class="muted"><strong>${p.pick ? 'Topics' : 'Field'}:</strong> ${esc(p.field)}</p>` : ''}
            ${p.summary ? `<p>${p.pick ? '<strong>How to apply:</strong> ' : ''}${esc(p.summary)}</p>` : ''}
            ${p.raw && p.raw.applyEmail ? `<p><strong>Apply by email:</strong> <a href="mailto:${esc(p.raw.applyEmail)}">${esc(p.raw.applyEmail)}</a></p>` : ''}
            ${p.salary ? `<p class="muted"><strong>Salary:</strong> ${esc(p.salary)}</p>` : ''}
            ${p.duration ? `<p class="muted"><strong>Duration / contract:</strong> ${esc(p.duration)}</p>` : ''}
            ${p.applyUrl ? `<p><a href="${esc(p.applyUrl)}" target="_blank" rel="noopener">Call / application page ↗</a></p>` : ''}
          </details>` : ''}
        </div>
        <div class="br-actions">
          ${inTracker ? '<span class="muted">✓ In tracker</span>'
            : `<button class="btn small primary" data-add="${esc(p.id)}">+ Track</button>`}
        </div>
      </article>`;
    }).join('') || '<p class="empty">No open positions match these filters.</p>';
    $('#br-more').hidden = list.length <= shown;
    $('#br-more').textContent = `Show more (${list.length - shown} more)`;
  }

  function add(id) {
    const p = all.find(x => x.id === id);
    if (!p) return;
    if (p.pick) { C.add({ ...p.raw, source: p.origin || 'Claude daily pick' }, { sourceId: p.id, suggestionId: p.raw.id }); return; }
    C.add({
      title: p.title, type: p.type, institution: p.institution, country: p.country, city: p.city,
      callUrl: p.url, deadline: p.deadline, salary: p.salary, duration: p.duration,
      applyUrl: p.applyUrl, keywords: hitsOf(p).join(', '), source: p.source,
      procedure: [p.titleAlt, p.summary].filter(Boolean).join('\n\n'),
      notes: p.kind ? `Position type at source: ${p.kind}` : '',
    }, { sourceId: p.id });
  }

  // ---------- events ----------
  const rerender = () => { shown = PAGE; savePrefs(); render(); };
  $('#br-country').addEventListener('change', e => { prefs.country = e.target.value; rerender(); });
  $('#br-source').addEventListener('change', e => { prefs.source = e.target.value; rerender(); });
  $('#br-type').addEventListener('change', e => { prefs.type = e.target.value; rerender(); });
  $('#br-sort').addEventListener('change', e => { prefs.sort = e.target.value; rerender(); });
  $('#br-relevant').addEventListener('change', e => { prefs.relevant = e.target.checked; rerender(); });
  $('#br-search').addEventListener('input', e => { prefs.q = e.target.value; rerender(); });
  $('#br-more').addEventListener('click', () => { shown += PAGE; render(); });
  $('#br-list').addEventListener('click', e => {
    const id = e.target.dataset.add;
    if (id) add(id);
  });
  $('#br-toggle').addEventListener('click', () => {
    const body = $('#br-body');
    body.hidden = !body.hidden;
    $('#br-toggle').textContent = body.hidden ? 'Show' : 'Hide';
  });
  C.onChange(() => { if (all.length) render(); });

  function setPersonal(next, msg, { silent = false } = {}) {
    personal = next;
    savePersonal({ silent });
    applyPersonal();
    if (isPersonal() && prefs.sort === 'deadline') { prefs.sort = 'match'; $('#br-sort').value = 'match'; }
    renderMatchBar();
    rerender();
    if (msg) $('#match-status').textContent = msg;
  }

  // used by cloud.js to keep the CV-based matching profile in the signed-in account
  window.CareerlyMatch = {
    get: () => personal,
    set: next => {
      if (JSON.stringify(next || null) === JSON.stringify(personal || null)) return; // unchanged: keep the view as it is
      if (all.length) setPersonal(next, '', { silent: true });
      else { personal = next; savePersonal({ silent: true }); }
    },
    onChange: fn => personalListeners.push(fn),
  };

  $('#match-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const status = $('#match-status');
    status.textContent = `Reading ${file.name}…`;
    try {
      if (!window.CareerlyCV) throw new Error('The CV reader did not load. Please reload the page.');
      const text = await window.CareerlyCV.extractText(file);
      const terms = buildTerms(text);
      if (terms.length < 3) throw new Error('Could not find enough research topics in this CV to match on.');
      setPersonal({ name: file.name.replace(/\.[^.]+$/, ''), terms, savedAt: Date.now() },
        `Found ${terms.length} topics in your CV. Remove any that don't fit, or add your own.`);
    } catch (err) {
      status.textContent = err.message;
    }
  });
  $('#match-clear').addEventListener('click', () => {
    if (!confirm('Forget your CV topics on this browser and go back to the default ranking?')) return;
    setPersonal(null, '');
  });
  $('#match-chips').addEventListener('click', e => {
    const i = e.target.dataset.rmTerm;
    if (i === undefined) return;
    personal.terms.splice(Number(i), 1);
    setPersonal(personal, '');
  });
  $('#match-add').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = norm(e.target.value).trim();
    e.target.value = '';
    if (!t || personal.terms.some(x => x.t === t)) return;
    const top = personal.terms[0] ? personal.terms[0].w : 3;
    personal.terms.unshift({ t, w: top, custom: true });
    setPersonal(personal, `Added "${t}".`);
  });

  load();

  // Keep an open page fresh: new positions arrive every morning (by 10:00 Rome time).
  // Re-check every 30 minutes and whenever the tab comes back into view; only re-render
  // if the data actually changed, so filters and scrolling aren't disturbed.
  let lastStamp = '';
  async function refreshIfChanged() {
    const [d, p] = await Promise.all([getJson(URL), getJson('data/suggestions.json')]);
    const stamp = `${d && d.updatedAt}|${p && p.updatedAt}`;
    if (!lastStamp) { lastStamp = stamp; return; }
    if (stamp !== lastStamp) {
      lastStamp = stamp;
      const keepShown = shown;
      await load();
      shown = keepShown;
      render();
      C.toast && C.toast('New positions have arrived.');
    }
  }
  refreshIfChanged();
  setInterval(refreshIfChanged, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshIfChanged();
  });
})();
