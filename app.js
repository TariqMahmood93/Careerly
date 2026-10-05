/* Careerly — simple research-application tracker.
 * All data is stored in the browser (localStorage). Use Backup → Export
 * regularly so nothing is lost if browser data is cleared.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'careerly.positions.v1';
  const META_KEY = 'careerly.meta.v1';
  const DAY = 24 * 60 * 60 * 1000;
  const NO_RESPONSE_DAYS = 60;
  const DEADLINE_WARN_DAYS = 7;
  const BACKUP_REMIND_DAYS = 14;

  const STATUSES = [
    { id: 'saved',        label: 'Saved / to apply',      color: '#64748b' },
    { id: 'preparing',    label: 'Preparing',             color: '#2563eb' },
    { id: 'applied',      label: 'Applied',               color: '#4f46e5' },
    { id: 'under_review', label: 'Under review',          color: '#9333ea' },
    { id: 'interview',    label: 'Interview',             color: '#0d9488' },
    { id: 'offer',        label: 'Offer / accepted',      color: '#16a34a' },
    { id: 'rejected',     label: 'Rejected',              color: '#dc2626' },
    { id: 'no_response',  label: 'No response',           color: '#d97706' },
    { id: 'withdrawn',    label: 'Withdrawn / declined',  color: '#78716c' },
    { id: 'missed',       label: 'Deadline missed',       color: '#a16207' },
  ];
  const STATUS = Object.fromEntries(STATUSES.map(s => [s.id, s]));
  const NOT_SENT = new Set(['saved', 'preparing']);
  const WAITING = new Set(['applied', 'under_review']);
  // Moving to one of these implies the application was sent
  const SENT_MARKERS = new Set(['applied', 'under_review', 'interview']);

  const TYPES = [
    'Postdoc', 'Researcher / Research Scientist', 'Research Fellow',
    'MSCA Postdoctoral Fellowship', 'Junior Group Leader', 'Lecturer / Assistant Professor',
    'Research Engineer', 'PhD position', 'Other',
  ];

  const COUNTRIES = [
    'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic', 'Denmark',
    'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy',
    'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Poland', 'Portugal',
    'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden',
    // Non-EU but common for European research jobs
    'Iceland', 'Norway', 'Switzerland', 'United Kingdom', 'Other',
  ];

  const DEFAULT_DOCS = [
    'CV', 'Cover letter', 'Research statement / proposal', 'Publication list',
    'Reference letters', 'Degree certificates', 'Transcripts',
  ];

  const METHOD_LABEL = {
    email: 'By email', portal: 'Online portal / website', both: 'Email + portal', other: 'Other',
  };

  // ---------- State ----------
  let positions = load(STORAGE_KEY, []);
  let meta = load(META_KEY, { lastExport: null });
  let editingId = null;
  let formDocs = [];

  // ---------- Helpers ----------
  const $ = sel => document.querySelector(sel);

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function loadText(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function safeUrl(u) {
    return /^https?:\/\//i.test(u || '') ? u : '';
  }

  function todayISO() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function parseDate(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function daysFromToday(iso) {
    const d = parseDate(iso);
    if (!d) return null;
    const t = parseDate(todayISO());
    return Math.round((d - t) / DAY);
  }

  function fmtDate(iso) {
    const d = parseDate(iso);
    return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function toast(msg, action) {
    const el = $('#toast');
    el.textContent = msg;
    if (action) {
      const b = document.createElement('button');
      b.className = 'toast-action';
      b.textContent = action.label;
      b.addEventListener('click', () => { el.hidden = true; action.run(); });
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, action ? 7000 : 2500);
  }

  function fillSelect(sel, items, { blank } = {}) {
    const opts = items.map(i => typeof i === 'string' ? { value: i, label: i } : i);
    sel.innerHTML = (blank ? `<option value="">${esc(blank)}</option>` : '') +
      opts.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  }

  function statusBadge(id) {
    const s = STATUS[id] || STATUS.saved;
    return `<span class="badge" style="--status-color:${s.color}"><span class="dot"></span>${esc(s.label)}</span>`;
  }

  function deadlineChip(p, { full = false } = {}) {
    if (!p.deadline) {
      return full
        ? `<span class="chip deadline-missing" data-set-deadline="${p.id}" title="Add the deadline">⏰ Deadline not stated · <u>add</u></span>`
        : '';
    }
    const days = daysFromToday(p.deadline);
    const open = NOT_SENT.has(p.status);
    let cls = '', extra = '';
    if (days < 0) { cls = open ? 'overdue' : ''; extra = ` · passed ${-days}d ago`; }
    else if (days === 0) { cls = open ? 'overdue' : ''; extra = ' · today!'; }
    else {
      extra = ` · ${days} day${days === 1 ? '' : 's'} left`;
      if (open && days <= DEADLINE_WARN_DAYS) cls = 'due-soon';
    }
    if (!full && !open) extra = '';
    return `<span class="chip ${cls}">⏰ ${full ? 'Deadline: ' : ''}${esc(fmtDate(p.deadline))}${extra}</span>`;
  }

  function howToApplyShort(p) {
    const parts = [];
    if (p.applyEmail) parts.push(`✉ ${p.applyEmail}`);
    if (p.applyUrl) parts.push(`🌐 ${p.applyUrl.replace(/^https?:\/\//, '')}`);
    if (!parts.length && p.method) parts.push(METHOD_LABEL[p.method] || '');
    return parts.join('  ·  ');
  }

  // ---------- Rendering ----------
  function renderStats() {
    const counts = Object.fromEntries(STATUSES.map(s => [s.id, 0]));
    positions.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1; });
    const active = $('#filter-status').value;
    const total = `<button class="stat ${active ? '' : 'active'}" data-status="">
        <div class="num">${positions.length}</div><div class="lbl">Total</div></button>`;
    $('#stats').innerHTML = total + STATUSES
      .filter(s => counts[s.id] > 0 || ['applied', 'under_review', 'rejected', 'offer'].includes(s.id))
      .map(s => `<button class="stat ${active === s.id ? 'active' : ''}" data-status="${s.id}" style="--status-color:${s.color}">
        <div class="num">${counts[s.id]}</div>
        <div class="lbl"><span class="dot"></span>${esc(s.label)}</div></button>`).join('');
  }

  function renderAlerts() {
    const out = [];
    const soon = [], passed = [], stale = [];
    positions.forEach(p => {
      const d = daysFromToday(p.deadline);
      if (NOT_SENT.has(p.status) && d !== null) {
        if (d < 0) passed.push(p);
        else if (d <= DEADLINE_WARN_DAYS) soon.push(p);
      }
      if (WAITING.has(p.status) && p.appliedDate) {
        const lastContact = [p.appliedDate, p.followUpDate].filter(Boolean).sort().pop();
        if (-daysFromToday(lastContact) >= NO_RESPONSE_DAYS) stale.push(p);
      }
    });
    const link = p => `<a data-open="${p.id}">${esc(p.title)} — ${esc(p.institution)}</a>`;
    if (soon.length) out.push(`<div class="alert"><strong>Deadlines within ${DEADLINE_WARN_DAYS} days:</strong> ${soon.map(link).join(', ')}</div>`);
    if (passed.length) out.push(`<div class="alert"><strong>Deadline passed but not marked as applied:</strong> ${passed.map(link).join(', ')}</div>`);
    if (stale.length) out.push(`<div class="alert"><strong>No news for ${NO_RESPONSE_DAYS}+ days</strong> (follow up or mark as “No response”): ${stale.map(link).join(', ')}</div>`);
    if (positions.length) {
      const since = meta.lastExport ? Math.floor((Date.now() - meta.lastExport) / DAY) : null;
      if (since === null || since >= BACKUP_REMIND_DAYS) {
        out.push(`<div class="alert"><strong>Backup reminder:</strong> your data lives only in this browser. ${since === null ? 'You have never exported a backup.' : `Last backup was ${since} days ago.`} Use <em>Backup → Export backup</em>.</div>`);
      }
    }
    $('#alerts').innerHTML = out.join('');
  }

  function filtered() {
    const q = $('#search').value.trim().toLowerCase();
    const st = $('#filter-status').value;
    const co = $('#filter-country').value;
    const ty = $('#filter-type').value;
    const sort = $('#sort').value;

    let list = positions.filter(p => {
      if (st && p.status !== st) return false;
      if (co && p.country !== co) return false;
      if (ty && p.type !== ty) return false;
      if (q) {
        const hay = [p.title, p.institution, p.group, p.pi, p.keywords, p.city, p.country,
          p.notes, p.procedure, p.reference, p.contactName].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const far = '9999-12-31';
    const cmp = {
      deadline: (a, b) => {
        // Open (not yet sent) applications first, by deadline; then the rest
        const ao = NOT_SENT.has(a.status) ? 0 : 1, bo = NOT_SENT.has(b.status) ? 0 : 1;
        return ao - bo || (a.deadline || far).localeCompare(b.deadline || far);
      },
      updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
      applied: (a, b) => (b.appliedDate || '').localeCompare(a.appliedDate || ''),
      institution: (a, b) => (a.institution || '').localeCompare(b.institution || ''),
    }[sort];
    return list.sort(cmp);
  }

  function renderList() {
    const list = filtered();
    $('#empty').hidden = positions.length > 0;
    $('#list').innerHTML = list.map(p => {
      const s = STATUS[p.status] || STATUS.saved;
      const docs = p.docs || [];
      const ready = docs.filter(d => d.done).length;
      const loc = [p.city, p.country].filter(Boolean).join(', ');
      return `<article class="card" data-id="${p.id}" style="--status-color:${s.color}">
        <div class="card-top">
          <div>
            <h3>${p.priority === 'high' ? '★ ' : ''}${esc(p.title)}</h3>
            <div class="inst">${esc(p.institution)}${p.pi ? ' · ' + esc(p.pi) : ''}</div>
          </div>
          ${statusBadge(p.status)}
        </div>
        <div class="meta">
          ${loc ? `<span class="chip">📍 ${esc(loc)}</span>` : ''}
          ${p.type ? `<span class="chip">${esc(p.type)}</span>` : ''}
          ${deadlineChip(p, { full: true })}
          ${docs.length && NOT_SENT.has(p.status) ? `<span class="chip">📄 ${ready}/${docs.length} docs ready</span>` : ''}
          ${p.appliedDate ? `<span class="chip">Applied ${esc(fmtDate(p.appliedDate))}</span>` : ''}
        </div>
        <div class="how">${esc(howToApplyShort(p))}</div>
        <div class="card-foot">
          <span>Updated ${esc(new Date(p.updatedAt || p.createdAt).toLocaleDateString())}</span>
          <span class="card-actions">
            <select class="quick-status" data-quick="${p.id}" title="Change status">
              ${STATUSES.map(x => `<option value="${x.id}" ${x.id === p.status ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
            </select>
            <button type="button" class="icon-btn del-btn" data-del="${p.id}" title="Delete this position" aria-label="Delete">🗑</button>
          </span>
        </div>
      </article>`;
    }).join('');
    if (positions.length && !list.length) {
      $('#list').innerHTML = '<p class="empty" style="grid-column:1/-1">No positions match your filters.</p>';
    }
  }

  function renderCountryFilter() {
    const sel = $('#filter-country');
    const cur = sel.value;
    const used = [...new Set(positions.map(p => p.country).filter(Boolean))].sort();
    fillSelect(sel, used, { blank: 'All countries' });
    sel.value = used.includes(cur) ? cur : '';
  }

  // Copy an outside record (daily suggestion or collected position) into the tracker
  function addToTracker(x, extra = {}) {
    const now = Date.now();
    const fields = ['title', 'type', 'reference', 'institution', 'group', 'pi', 'keywords', 'country',
      'city', 'callUrl', 'deadline', 'startDate', 'duration', 'salary', 'method', 'applyEmail',
      'applyUrl', 'emailSubject', 'procedure', 'contactName', 'contactEmail'];
    const p = { id: uid(), createdAt: now, updatedAt: now, status: 'saved', priority: 'normal', ...extra };
    fields.forEach(f => { p[f] = x[f] ?? ''; });
    if (!TYPES.includes(p.type)) p.type = p.type ? 'Other' : 'Postdoc';
    if (!COUNTRIES.includes(p.country)) p.country = p.country ? 'Other' : '';
    if (!METHOD_LABEL[p.method]) p.method = p.applyEmail ? 'email' : p.applyUrl ? 'portal' : 'other';
    p.notes = [x.why && `Why it matches (auto-search): ${x.why}`, x.source && `Found on: ${x.source}`, x.notes]
      .filter(Boolean).join('\n');
    p.docs = (Array.isArray(x.documents) && x.documents.length ? x.documents : DEFAULT_DOCS.slice(0, 4))
      .map(name => ({ name: String(name), done: false }));
    p.history = [{ status: 'saved', date: todayISO() }];
    positions.push(p);
    persist();
    render();
    toast('Added to your tracker');
    return p;
  }



  // Small API for positions.js (the "All open positions" browser)
  const listeners = [];
  window.Careerly = {
    add: (x, extra) => addToTracker(x, extra),
    tracked: () => ({
      ids: new Set(positions.map(p => p.sourceId).filter(Boolean)),
      urls: new Set(positions.map(p => p.callUrl).filter(Boolean)),
    }),
    onChange: fn => listeners.push(fn),
    esc, fmtDate, daysFromToday, todayISO,
  };

  function render() {
    listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
    renderCountryFilter();
    renderStats();
    renderAlerts();
    renderList();
  }

  // ---------- Status changes ----------
  function setStatus(p, status, date = todayISO()) {
    if (p.status === status) return;
    p.status = status;
    p.history = p.history || [];
    p.history.push({ status, date });
    if (SENT_MARKERS.has(status) && !p.appliedDate) p.appliedDate = date;
  }

  // ---------- Form ----------
  const form = $('#position-form');

  function renderDocs() {
    $('#docs-list').innerHTML = formDocs.map((d, i) => `
      <label><input type="checkbox" data-doc="${i}" ${d.done ? 'checked' : ''}> ${esc(d.name)}
        <button type="button" class="rm" data-rm="${i}" title="Remove">✕</button></label>`).join('');
  }

  function openForm(p) {
    editingId = p ? p.id : null;
    form.reset();
    $('#form-title').textContent = p ? 'Edit position' : 'New position';
    $('#btn-delete').hidden = !p;
    const data = p || { status: 'saved', method: 'email', priority: 'normal', type: 'Postdoc' };
    for (const el of form.elements) {
      if (el.name && el.name in data) el.value = data[el.name] ?? '';
    }
    formDocs = p ? structuredClone(p.docs || []) : DEFAULT_DOCS.slice(0, 4).map(name => ({ name, done: false }));
    renderDocs();
    $('#form-dialog').showModal();
    form.elements.title.focus();
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    for (const k in data) data[k] = data[k].trim();
    const now = Date.now();

    if (editingId) {
      const p = positions.find(x => x.id === editingId);
      const newStatus = data.status;
      delete data.status;
      Object.assign(p, data, { docs: formDocs, updatedAt: now });
      setStatus(p, newStatus);
    } else {
      const p = {
        id: uid(), createdAt: now, updatedAt: now, ...data, docs: formDocs,
        history: [{ status: data.status, date: todayISO() }],
      };
      if (SENT_MARKERS.has(p.status) && !p.appliedDate) p.appliedDate = todayISO();
      positions.push(p);
    }
    persist();
    $('#form-dialog').close();
    render();
    toast('Saved');
  });

  $('#docs-list').addEventListener('change', e => {
    const i = e.target.dataset.doc;
    if (i !== undefined) formDocs[i].done = e.target.checked;
  });
  $('#docs-list').addEventListener('click', e => {
    const i = e.target.dataset.rm;
    if (i !== undefined) { formDocs.splice(Number(i), 1); renderDocs(); }
  });
  function addDoc() {
    const input = $('#new-doc');
    const name = input.value.trim();
    if (name) { formDocs.push({ name, done: false }); renderDocs(); }
    input.value = '';
    input.focus();
  }
  $('#btn-add-doc').addEventListener('click', addDoc);
  $('#new-doc').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addDoc(); }
  });

  // Delete with a few seconds to undo
  function deletePosition(id) {
    const index = positions.findIndex(x => x.id === id);
    if (index < 0) return;
    const [removed] = positions.splice(index, 1);
    persist();
    render();
    toast(`Deleted "${removed.title.length > 40 ? removed.title.slice(0, 40) + '…' : removed.title}"`, {
      label: 'Undo',
      run: () => {
        positions.splice(Math.min(index, positions.length), 0, removed);
        persist();
        render();
        toast('Restored');
      },
    });
  }

  $('#btn-delete').addEventListener('click', () => {
    $('#form-dialog').close();
    deletePosition(editingId);
  });
  $('#btn-detail-delete').addEventListener('click', () => {
    $('#detail-dialog').close();
    deletePosition(detailId);
  });

  // ---------- Detail view ----------
  let detailId = null;

  function row(label, value, html = false) {
    if (!value) return '';
    return `<dt>${esc(label)}</dt><dd>${html ? value : esc(value)}</dd>`;
  }

  function link(u) {
    const s = safeUrl(u);
    return s ? `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s)}</a>` : esc(u);
  }

  function mail(addr, subject) {
    if (!addr) return '';
    const href = `mailto:${encodeURIComponent(addr)}${subject ? '?subject=' + encodeURIComponent(subject) : ''}`;
    return `<a href="${esc(href)}">${esc(addr)}</a><button class="btn small copy" data-copy="${esc(addr)}">Copy</button>`;
  }

  function openDetail(id) {
    const p = positions.find(x => x.id === id);
    if (!p) return;
    detailId = id;
    $('#detail-title').textContent = p.title;
    const docs = (p.docs || []).map(d => `${d.done ? '✅' : '⬜'} ${esc(d.name)}`).join('<br>');
    const history = (p.history || []).slice().reverse()
      .map(h => `<li><time>${esc(fmtDate(h.date))}</time>${statusBadge(h.status)}</li>`).join('');

    $('#detail-body').innerHTML = `
      <div class="detail-section">${statusBadge(p.status)} ${p.priority === 'high' ? '<span class="chip">★ High priority</span>' : ''} ${deadlineChip(p, { full: true })}</div>

      <div class="detail-section"><h4>Position</h4><dl class="kv">
        ${row('Institution', p.institution)}
        ${row('Department / group', p.group)}
        ${row('PI / supervisor', p.pi)}
        ${row('Type', p.type)}
        ${row('Reference / call ID', p.reference)}
        ${row('Location', [p.city, p.country].filter(Boolean).join(', '))}
        ${row('Field / keywords', p.keywords)}
        ${row('Call / job ad', p.callUrl && link(p.callUrl), true)}
        ${row('Deadline', fmtDate(p.deadline))}
        ${row('Start date', p.startDate)}
        ${row('Duration', p.duration)}
        ${row('Salary / funding', p.salary)}
      </dl></div>

      <div class="detail-section"><h4>How to apply</h4><dl class="kv">
        ${row('Method', METHOD_LABEL[p.method])}
        ${row('Send to', mail(p.applyEmail, p.emailSubject), true)}
        ${row('Email subject', p.emailSubject)}
        ${row('Portal / website', p.applyUrl && link(p.applyUrl), true)}
        ${row('Portal account', p.portalAccount)}
        ${row('Required documents', docs, true)}
      </dl>
      ${p.procedure ? `<div class="pre" style="margin-top:8px">${esc(p.procedure)}</div>` : ''}
      </div>

      ${p.contactName || p.contactEmail ? `<div class="detail-section"><h4>Contact</h4><dl class="kv">
        ${row('Name', p.contactName)}
        ${row('Email', mail(p.contactEmail), true)}
      </dl></div>` : ''}

      <div class="detail-section"><h4>Progress</h4><dl class="kv">
        ${row('Applied on', fmtDate(p.appliedDate))}
        ${row('Last follow-up', fmtDate(p.followUpDate))}
        ${row('Interview', fmtDate(p.interviewDate))}
      </dl>
      ${history ? `<ul class="timeline" style="margin-top:8px">${history}</ul>` : ''}
      </div>

      ${p.notes ? `<div class="detail-section"><h4>Notes</h4><div class="pre">${esc(p.notes)}</div></div>` : ''}
    `;
    $('#detail-dialog').showModal();
  }

  $('#detail-body').addEventListener('click', e => {
    const c = e.target.dataset.copy;
    if (c) navigator.clipboard?.writeText(c).then(() => toast('Copied'));
  });
  $('#btn-detail-edit').addEventListener('click', () => {
    $('#detail-dialog').close();
    openForm(positions.find(x => x.id === detailId));
  });

  // ---------- List interactions ----------
  $('#list').addEventListener('change', e => {
    const id = e.target.dataset.quick;
    if (!id) return;
    const p = positions.find(x => x.id === id);
    setStatus(p, e.target.value);
    p.updatedAt = Date.now();
    persist();
    render();
    toast(`Status → ${STATUS[p.status].label}`);
  });
  $('#list').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { deletePosition(del.dataset.del); return; }
    const setDl = e.target.closest('[data-set-deadline]');
    if (setDl) {
      openForm(positions.find(x => x.id === setDl.dataset.setDeadline));
      form.elements.deadline.focus();
      return;
    }
    if (e.target.closest('select')) return;
    const card = e.target.closest('.card');
    if (card) openDetail(card.dataset.id);
  });
  $('#alerts').addEventListener('click', e => {
    const id = e.target.dataset.open;
    if (id) openDetail(id);
  });
  $('#stats').addEventListener('click', e => {
    const b = e.target.closest('.stat');
    if (!b) return;
    $('#filter-status').value = b.dataset.status;
    render();
  });
  ['#search', '#filter-status', '#filter-country', '#filter-type', '#sort'].forEach(sel =>
    $(sel).addEventListener('input', render));

  // ---------- Dialog closing ----------
  document.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => b.closest('dialog').close()));

  // ---------- Backup ----------
  const menu = $('#data-menu');
  $('#btn-data').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', e => { if (!e.target.closest('.menu')) menu.hidden = true; });

  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('#btn-export-json').addEventListener('click', () => {
    download(`careerly-backup-${todayISO()}.json`,
      JSON.stringify({ app: 'careerly', version: 1, exportedAt: new Date().toISOString(), positions }, null, 2),
      'application/json');
    meta.lastExport = Date.now();
    persist();
    menu.hidden = true;
    render();
  });

  $('#btn-export-csv').addEventListener('click', () => {
    const cols = [
      ['title', 'Title'], ['type', 'Type'], ['institution', 'Institution'], ['group', 'Group'],
      ['pi', 'PI'], ['city', 'City'], ['country', 'Country'], ['deadline', 'Deadline'],
      ['status', 'Status'], ['appliedDate', 'Applied'], ['method', 'Method'],
      ['applyEmail', 'Apply email'], ['applyUrl', 'Apply URL'], ['callUrl', 'Call URL'],
      ['procedure', 'Procedure'], ['contactName', 'Contact'], ['contactEmail', 'Contact email'],
      ['salary', 'Salary'], ['duration', 'Duration'], ['notes', 'Notes'],
    ];
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.map(c => cell(c[1])).join(',')].concat(positions.map(p =>
      cols.map(([k]) => cell(k === 'status' ? STATUS[p.status]?.label : k === 'method' ? METHOD_LABEL[p.method] : p[k])).join(',')));
    download(`careerly-${todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
    menu.hidden = true;
  });

  $('#import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    menu.hidden = true;
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data.positions;
      if (!Array.isArray(incoming)) throw new Error('No positions found in file');
      const byId = new Map(positions.map(p => [p.id, p]));
      let added = 0, updated = 0;
      incoming.forEach(p => {
        if (!p || !p.title) return;
        if (!p.id) p.id = uid();
        if (!STATUS[p.status]) p.status = 'saved';
        const existing = byId.get(p.id);
        if (!existing) { byId.set(p.id, p); added++; }
        else if ((p.updatedAt || 0) > (existing.updatedAt || 0)) { byId.set(p.id, p); updated++; }
      });
      positions = [...byId.values()];
      persist();
      render();
      toast(`Imported: ${added} new, ${updated} updated`);
    } catch (err) {
      alert('Could not import this file: ' + err.message);
    }
  });

  // ---------- Init ----------
  fillSelect(form.elements.type, TYPES);
  fillSelect(form.elements.country, COUNTRIES, { blank: '— select —' });
  fillSelect(form.elements.status, STATUSES.map(s => ({ value: s.id, label: s.label })));
  fillSelect($('#filter-status'), STATUSES.map(s => ({ value: s.id, label: s.label })), { blank: 'All statuses' });
  fillSelect($('#filter-type'), TYPES, { blank: 'All position types' });
  $('#btn-new').addEventListener('click', () => openForm(null));
  render();
})();
