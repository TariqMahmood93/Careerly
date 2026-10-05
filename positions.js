/* Careerly: "All open positions" browser.
 * Shows every open call collected daily from Bandi MUR, EURAXESS and jobs.ac.uk
 * (data/positions.json, built by scripts/fetch_positions.py in GitHub Actions),
 * with filters for country, source, type and relevance to the profile.
 */
(() => {
  'use strict';

  const URL = 'data/positions.json';
  const PREFS_KEY = 'careerly.browse.v1';
  const PAGE = 40;
  const C = window.Careerly;
  const { esc, fmtDate, daysFromToday, todayISO } = C;
  const $ = sel => document.querySelector(sel);

  let all = [];
  let meta = {};
  let shown = PAGE;

  const prefs = (() => {
    try { return { relevant: true, sort: 'deadline', ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; }
    catch { return { relevant: true, sort: 'deadline' }; }
  })();
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }

  async function load() {
    try {
      const res = await fetch(`${URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      all = (data.positions || []).filter(p => !p.deadline || daysFromToday(p.deadline) >= 0);
      meta = data;
      $('#browse').hidden = false;
      restoreControls();
      render();
    } catch { /* no data yet, or opened as a local file */ }
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
    let list = prefs.relevant ? all.filter(p => p.relevant) : all;
    if (q) {
      const terms = q.split(/\s+/);
      list = list.filter(p => {
        const hay = [p.title, p.titleAlt, p.institution, p.city, p.country, p.field, p.summary, p.kind, (p.matched || []).join(' ')]
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
      newest: (a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || '') || (b.score - a.score),
      match: (a, b) => b.score - a.score || (a.deadline || far).localeCompare(b.deadline || far),
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
    const relevantCount = all.filter(p => p.relevant).length;
    const newToday = list.filter(p => p.firstSeen === today).length;
    $('#br-summary').innerHTML =
      `<strong>${list.length}</strong> shown · ${all.length} open calls in total, ${relevantCount} match your profile` +
      (newToday ? ` · <strong>${newToday} new today</strong>` : '') +
      (meta.updatedAt ? ` · updated ${esc(new Date(meta.updatedAt).toLocaleString())}` : '');
    const srcInfo = Object.entries(meta.sources || {})
      .map(([name, s]) => `${esc(name)}: ${s.ok === false ? '⚠️ failed, showing previous data' : (s.count ?? '?')}`).join(' · ');
    $('#br-sources').textContent = srcInfo ? `Sources — ${srcInfo}` : '';

    $('#br-list').innerHTML = list.slice(0, shown).map(p => {
      const inTracker = tracked.ids.has(p.id) || tracked.urls.has(p.url);
      const loc = [p.city, p.country].filter(Boolean).join(', ');
      return `<article class="br-item">
        <div class="br-main">
          <h3><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>
            ${p.firstSeen === today ? '<span class="chip new">NEW</span>' : ''}</h3>
          ${p.titleAlt ? `<div class="muted br-alt">${esc(p.titleAlt)}</div>` : ''}
          <div class="inst">${esc(p.institution || '')}</div>
          <div class="meta">
            ${loc ? `<span class="chip">📍 ${esc(loc)}</span>` : ''}
            ${deadlineChip(p.deadline)}
            <span class="chip">🔎 ${esc(p.source)}</span>
            ${p.kind || p.type ? `<span class="chip">${esc(p.kind || p.type)}</span>` : ''}
            ${(p.matched || []).slice(0, 4).map(m => `<span class="chip kw">${esc(m)}</span>`).join('')}
          </div>
          ${p.summary || p.field ? `<details><summary>Details</summary>
            ${p.field ? `<p class="muted"><strong>Field:</strong> ${esc(p.field)}</p>` : ''}
            ${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
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
    C.add({
      title: p.title, type: p.type, institution: p.institution, country: p.country, city: p.city,
      callUrl: p.url, deadline: p.deadline, salary: p.salary, duration: p.duration,
      applyUrl: p.applyUrl, keywords: (p.matched || []).join(', '), source: p.source,
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
  $('#br-more').addEventListener('click', () => { shown += PAGE * 2; render(); });
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

  load();
})();
