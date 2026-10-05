/* Careerly: optional accounts (Supabase).
 * Signing in keeps your tracker and your CV-based matching profile in your account, so they
 * appear on any device or browser, incognito included. Each account can only read and write
 * its own row (row-level security). Without signing in, everything stays in this browser only.
 */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://kipuqqslpnmpixsdtvir.supabase.co';
  // Publishable key: safe to ship in a web page; access is limited by row-level security.
  const SUPABASE_KEY = 'sb_publishable_I6ffqrAWnfFTabDv2w9oFA_NeuVmZXa';
  const TABLE = 'user_state';

  const $ = sel => document.querySelector(sel);
  const C = window.Careerly;
  const M = () => window.CareerlyMatch;
  const dlg = $('#account-dialog');

  if (!window.supabase || !C) {
    document.body.classList.remove('auth-checking');
    const st = $('#auth-status');
    if (st) { st.textContent = 'Could not load the login service. Please check your connection and reload the page.'; st.className = 'profile-status error'; }
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  let user = null;
  let syncing = false;   // true while applying remote data, so we don't echo it back
  let saveTimer = null;

  // ---------- merging two copies (this browser + account) ----------
  function merge(local, remote) {
    const deleted = { ...(remote.deleted || {}) };
    for (const [id, t] of Object.entries(local.deleted || {})) deleted[id] = Math.max(t, deleted[id] || 0);
    const byId = new Map();
    for (const p of [...(remote.positions || []), ...(local.positions || [])]) {
      if (!p || !p.id) continue;
      const cur = byId.get(p.id);
      if (!cur || (p.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(p.id, p);
    }
    const positions = [...byId.values()].filter(p => !(deleted[p.id] && deleted[p.id] >= (p.updatedAt || 0)));
    // keep the deletion log small: drop entries older than 90 days
    const cutoff = Date.now() - 90 * 864e5;
    for (const id of Object.keys(deleted)) if (deleted[id] < cutoff) delete deleted[id];
    return { positions, deleted };
  }

  function newerPersonal(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return (a.savedAt || 0) >= (b.savedAt || 0) ? a : b;
  }

  // ---------- load / save ----------
  async function pull({ quiet = false } = {}) {
    if (!user) return;
    setSyncState('Syncing…');
    const { data, error } = await sb.from(TABLE).select('positions, deleted, personal').eq('user_id', user.id).maybeSingle();
    if (error) { setSyncState('⚠️ Sync failed'); if (!quiet) C.toast('Could not load your account data: ' + error.message); return; }
    const local = C.getState();
    const merged = merge(local, data || {});
    const personal = newerPersonal(M() && M().get(), data && data.personal);
    syncing = true;
    try {
      C.setState(merged);
      if (M()) M().set(personal);
    } finally {
      syncing = false;
    }
    const same = C.stableJSON;
    const changedRemote = !data
      || same(merged.positions) !== same(data.positions || [])
      || same(personal) !== same(data.personal || null);
    if (changedRemote) await push();
    else setSyncState('✓ Synced');
  }

  async function push() {
    if (!user) return;
    clearTimeout(saveTimer);
    setSyncState('Saving…');
    const { positions, deleted } = C.getState();
    const row = {
      user_id: user.id, positions, deleted,
      personal: (M() && M().get()) || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from(TABLE).upsert(row, { onConflict: 'user_id' });
    setSyncState(error ? '⚠️ Not saved, will retry' : '✓ Synced');
    if (error) saveTimer = setTimeout(push, 15000);
  }

  function scheduleSave() {
    if (!user || syncing) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(push, 800);
  }

  C.onPersist(scheduleSave);
  if (M()) M().onChange(scheduleSave);
  else document.addEventListener('DOMContentLoaded', () => M() && M().onChange(scheduleSave));

  // refresh when coming back to the tab (changes made on another device)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && user) pull({ quiet: true });
  });

  // ---------- UI ----------
  function setSyncState(text) {
    const el = $('#sync-state');
    if (el) el.textContent = text;
  }

  function setStatus(msg, kind = '') {
    const el = user ? $('#account-status') : $('#auth-status');
    el.textContent = msg;
    el.className = 'profile-status ' + kind;
  }

  function renderHeader() {
    const btn = $('#btn-account');
    if (user) {
      btn.innerHTML = `🔓 ${C.esc(user.email.split('@')[0])} <span id="sync-state" class="sync-state"></span>`;
      btn.title = `Signed in as ${user.email}. Click for account options.`;
    } else {
      btn.textContent = '🔐 Log in';
      btn.title = 'Log in to see your tracker and matches on any device';
    }
    document.body.classList.toggle('locked', !user);
    $('#account-in').hidden = !user;
    if (user) $('#account-email').textContent = user.email;
  }

  async function onSignedIn(u, { fresh = false } = {}) {
    user = u;
    renderHeader();
    await pull({ quiet: !fresh });
    if (fresh) C.toast(`Welcome! Your tracker is now saved in your account (${user.email}).`);
  }

  function onSignedOut() {
    user = null;
    clearTimeout(saveTimer);
    // don't leave the account's data behind on this (possibly shared) browser
    syncing = true;
    try {
      C.setState({ positions: [], deleted: {} });
      if (M()) M().set(null);
    } finally {
      syncing = false;
    }
    renderHeader();
  }

  $('#btn-account').addEventListener('click', () => {
    if (!user) return;
    setStatus('');
    dlg.showModal();
  });

  async function withBusy(fn) {
    const btns = document.querySelectorAll('#account-dialog button, #auth-screen button');
    btns.forEach(b => { b.disabled = true; });
    try { await fn(); } finally { btns.forEach(b => { b.disabled = false; }); }
  }

  function creds() {
    const email = $('#account-email-input').value.trim();
    const password = $('#account-password').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) { setStatus('Please enter a valid email address.', 'error'); return null; }
    return { email, password };
  }

  $('#account-login').addEventListener('click', () => withBusy(async () => {
    const c = creds();
    if (!c) return;
    if (!c.password) { setStatus('Please enter your password.', 'error'); return; }
    setStatus('Logging in…');
    const { data, error } = await sb.auth.signInWithPassword(c);
    if (error) {
      setStatus(/confirm/i.test(error.message)
        ? 'Please confirm your email first: open the link we sent you, then log in.'
        : error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message, 'error');
      return;
    }
    if (dlg.open) dlg.close();
    $('#account-password').value = '';
    await onSignedIn(data.user, { fresh: true });
  }));

  $('#account-signup').addEventListener('click', () => withBusy(async () => {
    const c = creds();
    if (!c) return;
    if (c.password.length < 8) { setStatus('Choose a password with at least 8 characters.', 'error'); return; }
    setStatus('Creating your account…');
    const redirect = location.origin + location.pathname;
    const { data, error } = await sb.auth.signUp({ ...c, options: { emailRedirectTo: redirect } });
    if (error) { setStatus(error.message, 'error'); return; }
    if (data.session) {
      $('#account-password').value = '';
      await onSignedIn(data.user, { fresh: true });
    } else {
      setStatus(`Almost done! We sent a confirmation link to ${c.email}. Open it, then come back and log in.`, 'ok');
    }
  }));

  $('#account-reset').addEventListener('click', () => withBusy(async () => {
    const email = $('#account-email-input').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setStatus('Type your email above first.', 'error'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    setStatus(error ? error.message : `If an account exists for ${email}, a password-reset link is on its way.`, error ? 'error' : 'ok');
  }));

  $('#account-logout').addEventListener('click', () => withBusy(async () => {
    await push();
    await sb.auth.signOut();
    dlg.close();
    C.toast('Logged out. Your tracker is safe in your account.');
  }));

  $('#account-sync').addEventListener('click', () => withBusy(async () => {
    await pull();
    setStatus('Synced with your account.', 'ok');
  }));

  $('#account-newpass-save').addEventListener('click', () => withBusy(async () => {
    const pw = $('#account-newpass').value;
    if (pw.length < 8) { setStatus('Choose a password with at least 8 characters.', 'error'); return; }
    const { error } = await sb.auth.updateUser({ password: pw });
    setStatus(error ? error.message : 'Password updated.', error ? 'error' : 'ok');
    if (!error) $('#account-newpass').value = '';
  }));

  // ---------- session ----------
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') onSignedOut();
    if (event === 'PASSWORD_RECOVERY' && session) {
      onSignedIn(session.user).then(() => {
        dlg.showModal();
        setStatus('Choose a new password below.', 'ok');
      });
    }
    if (event === 'TOKEN_REFRESHED' && session) user = session.user;
  });

  renderHeader();
  sb.auth.getSession().then(({ data }) => {
    document.body.classList.remove('auth-checking');
    if (data.session && data.session.user) onSignedIn(data.session.user);
    else $('#account-email-input').focus();
  }).catch(() => document.body.classList.remove('auth-checking'));
  // Enter key submits the login form
  ['#account-email-input', '#account-password'].forEach(sel => $(sel).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('#account-login').click(); }
  }));
})();
