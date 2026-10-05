/* Careerly: "My profile & CV" dialog.
 * Lets you upload your CV (PDF or text) and edit the search profile. Both are saved in this
 * site's repository as data/cv.md and data/profile.md, and the daily search reads them.
 * Anyone can view them; saving needs a fine-grained GitHub token, stored only in this browser.
 */
(() => {
  'use strict';

  const TOKEN_KEY = 'careerly.githubToken.v1';
  const BRANCH = 'main';
  const PROFILE_PATH = 'data/profile.md';
  const CV_PATH = 'data/cv.md';
  const CV_HEADER = '# CV (uploaded from the Careerly app)\n\n';

  // This site's own repository (owner.github.io/<repo>), with a fallback for local use
  const REPO = (() => {
    const h = location.hostname;
    const first = location.pathname.split('/').filter(Boolean)[0];
    return h.endsWith('.github.io') && first
      ? { owner: h.split('.')[0], repo: first }
      : { owner: 'TariqMahmood93', repo: 'Careerly' };
  })();

  const $ = sel => document.querySelector(sel);
  const dlg = $('#profile-dialog');
  let original = { profile: '', cv: '' };

  // ---------- small helpers ----------
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 3500);
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  }

  function setStatus(msg, kind = '') {
    const el = $('#profile-status');
    el.textContent = msg;
    el.className = 'profile-status ' + kind;
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  function apiUrl(path) {
    return `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${path}`;
  }

  async function gh(path, opts = {}) {
    const token = getToken();
    const res = await fetch(opts.url || apiUrl(path) + (opts.method ? '' : `?ref=${BRANCH}`), {
      method: opts.method || 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
    return res;
  }

  // ---------- load current files ----------
  // Latest version from GitHub (the published site can lag a minute behind); '' if missing.
  async function readFile(path) {
    try {
      const res = await gh(path);
      if (res.ok) return b64decode((await res.json()).content);
    } catch { /* offline or API limit: fall back to the published copy */ }
    try {
      const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
      return res.ok ? await res.text() : '';
    } catch {
      return '';
    }
  }

  function stripCvHeader(text) {
    return text.startsWith(CV_HEADER) ? text.slice(CV_HEADER.length) : text;
  }

  function showTokenState() {
    const has = !!getToken();
    $('#token-row').hidden = has;
    $('#token-saved').hidden = !has;
  }

  async function loadFiles() {
    setStatus('Loading your profile…');
    const [profile, cv] = await Promise.all([readFile(PROFILE_PATH), readFile(CV_PATH)]);
    original = { profile, cv: stripCvHeader(cv).trim() };
    $('#profile-text').value = profile;
    $('#cv-text').value = original.cv;
    $('#cv-file-name').textContent = original.cv ? 'A CV is saved. Upload a new file to replace it.' : 'No CV saved yet.';
    setStatus('');
  }

  async function openDialog() {
    $('#gh-token').value = '';
    setStatus('');
    showTokenState();
    dlg.showModal();
    await loadFiles();
  }

  // ---------- CV upload ----------
  let pdfjsReady = null;
  function loadPdfJs() {
    if (!pdfjsReady) {
      pdfjsReady = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/pdfjs/pdf.min.js';
        s.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
          resolve(window.pdfjsLib);
        };
        s.onerror = () => reject(new Error('Could not load the PDF reader'));
        document.head.appendChild(s);
      });
    }
    return pdfjsReady;
  }

  async function pdfToText(file) {
    const pdfjsLib = await loadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
    }
    return pages.join('\n\n');
  }

  function tidy(text) {
    return text
      .replace(/([a-z])-\s*\n\s*([a-z])/g, '$1$2') // re-join words hyphenated across lines
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function redact(text) {
    return text
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
      .replace(/(?:\+|00)\d{1,3}[\s.-]?\(?\d[\d\s().-]{6,}\d/g, '[phone removed]')
      .replace(/^(.*\b(?:phone|tel|telephone|mobile|cell)\b\s*[:.]?).*$/gim, '$1 [removed]');
  }

  // Word (.docx) files are zip archives; the text is in word/document.xml
  async function docxToText(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This Word file could not be read. Please save it as PDF and try again.');
    let p = dv.getUint32(eocd + 16, true);
    const count = dv.getUint16(eocd + 10, true);
    for (let n = 0; n < count; n++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
      if (name === 'word/document.xml') {
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        let data = buf.subarray(start, start + size);
        if (method === 8) {
          if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read Word files. Please save your CV as PDF.');
          data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
        }
        const xml = new TextDecoder().decode(data);
        return xml.replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>|<w:br\/>/g, '\n').replace(/<[^>]+>/g, '')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
      }
      p += 46 + nameLen + extra + comment;
    }
    throw new Error('No text found in this Word file. Please save it as PDF and try again.');
  }

  // Shared with positions.js (personal matching) and letter.js (cover letters)
  async function extractCvText(file) {
    let text;
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') text = await pdfToText(file);
    else if (/\.docx$/i.test(file.name)) text = await docxToText(file);
    else if (/\.(txt|md|markdown|tex)$/i.test(file.name) || file.type.startsWith('text/')) text = await file.text();
    else throw new Error('Please upload a PDF, Word (.docx) or text (.txt / .md) file.');
    text = tidy(text);
    if (text.length < 200) throw new Error('Very little text was found. If the PDF is a scanned image, upload a text-based PDF.');
    return text;
  }
  window.CareerlyCV = { extractText: extractCvText };

  $('#cv-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    $('#cv-file-name').textContent = `Reading ${file.name}…`;
    try {
      let text = await extractCvText(file);
      if ($('#cv-redact').checked) text = redact(text);
      $('#cv-text').value = text;
      $('#cv-file-name').textContent = `${file.name}: ${text.length.toLocaleString()} characters extracted. Check the text below, then save.`;
    } catch (err) {
      $('#cv-file-name').textContent = err.message;
    }
  });

  $('#cv-redact').addEventListener('change', e => {
    if (e.target.checked) $('#cv-text').value = redact($('#cv-text').value);
  });

  // ---------- token ----------
  $('#btn-forget-token').addEventListener('click', () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    showTokenState();
    toast('Token removed from this browser');
  });

  // ---------- save ----------
  async function putFile(path, content, message) {
    const cur = await gh(path);
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    if (!cur.ok && cur.status !== 404) throw apiError(cur.status);
    const res = await gh(path, {
      method: 'PUT',
      body: { message, content: b64encode(content), branch: BRANCH, ...(sha ? { sha } : {}) },
    });
    if (!res.ok) throw apiError(res.status);
  }

  function apiError(status) {
    if (status === 401) return new Error('GitHub rejected the token (expired or mistyped). Use "Forget it" and add a new one.');
    if (status === 403 || status === 404) return new Error(`The token can't write to ${REPO.owner}/${REPO.repo}. Give it "Contents: Read and write" access to that repository.`);
    if (status === 409) return new Error('The file changed on GitHub at the same time. Please try again.');
    return new Error(`GitHub error ${status}. Please try again.`);
  }

  $('#profile-form').addEventListener('submit', async e => {
    e.preventDefault();

    if (!getToken()) {
      const typed = $('#gh-token').value.trim();
      if (!typed) {
        setStatus('To save, paste a GitHub token in the box below (one-time per device).', 'error');
        $('#gh-token').focus();
        return;
      }
      try { localStorage.setItem(TOKEN_KEY, typed); } catch { /* ignore */ }
    }

    // Step 2: save changed files
    const profile = $('#profile-text').value.trim() + '\n';
    let cv = $('#cv-text').value.trim();
    if ($('#cv-redact').checked) cv = redact(cv);
    const changes = [];
    if (profile.trim() !== original.profile.trim()) changes.push([PROFILE_PATH, profile, 'Update search profile from the Careerly app']);
    if (cv !== original.cv) changes.push([CV_PATH, cv ? CV_HEADER + cv + '\n' : '', 'Update CV from the Careerly app']);
    if (!changes.length) { setStatus('Nothing changed.'); return; }

    const btn = $('#btn-profile-save');
    btn.disabled = true;
    setStatus('Saving to GitHub…');
    try {
      for (const [path, content, msg] of changes) await putFile(path, content, msg);
      original = { profile, cv };
      showTokenState();
      setStatus('Saved. The next daily search will use your updated CV and profile.', 'ok');
      toast('Profile saved. Your next search will use it.');
      setTimeout(() => dlg.close(), 1500);
    } catch (err) {
      if (/token/.test(err.message)) { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } showTokenState(); }
      setStatus(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  $('#btn-profile').addEventListener('click', openDialog);
  $('#token-help-link').href =
    'https://github.com/settings/personal-access-tokens/new';
})();
