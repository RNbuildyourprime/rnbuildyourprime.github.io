/* RN. en la web: inicio de sesión con Supabase y un adaptador que imita la base de datos del artifact.
   La app (logic.js/ui.js) no cambia: aquí se le da `window.claude.use('db' | 'user' | 'downloads')`. */
(function () {
  const CFG = window.RN_CONFIG || {};
  const $ = s => document.querySelector(s);
  const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hashAtLoad = location.hash || '';
  const hp = new URLSearchParams(hashAtLoad.replace(/^#/, ''));
  const linkType = hp.get('type');                       // invite | recovery | signup | magiclink
  const linkError = hp.get('error_description');

  const LOGO = document.querySelector('#rn-splash svg') ? document.querySelector('#rn-splash svg').outerHTML.replace('class="rn-fly"', 'class="au-logo"') : '<b>RN.</b>';
  const ERR = m => {
    m = String(m || '');
    if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
    if (/email not confirmed/i.test(m)) return 'Primero confirma tu correo: revisa tu bandeja de entrada.';
    if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.';
    if (/password should be at least|weak/i.test(m)) return 'La contraseña es muy corta: usa al menos 8 caracteres.';
    if (/same.*password|different from the old/i.test(m)) return 'Usa una contraseña distinta a la anterior.';
    if (/expired|invalid.*(link|token)|otp/i.test(m)) return 'El enlace ya expiró o ya se usó. Pide uno nuevo.';
    if (/RN_NO_INVITE|database error saving new user/i.test(m)) return 'Ese correo aún no tiene invitación. Pídele a quien te compartió RN. que te agregue, o apúntate en la lista de espera.';
    if (/already registered|already been registered|user already exists/i.test(m)) return 'Ese correo ya tiene cuenta. Inicia sesión o recupera tu contraseña.';
    if (/signups? not allowed|signup.*disabled/i.test(m)) return 'El registro está cerrado por ahora. Pide tu invitación.';
    if (/network|fetch/i.test(m)) return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.';
    return 'Algo salió mal (' + m + ').';
  };

  if (!CFG.url || !CFG.key || !window.supabase) { showFatal('Falta la configuración de la base de datos (config.js).'); return; }
  const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'rn-auth' } });

  /* ---------- Adaptador: mismo contrato que la base de datos del artifact ---------- */
  function makeDB(uid) {
    const T = () => sb.from('rn_docs');
    const fail = e => { throw { code: /fetch|network/i.test(e && e.message || '') ? 'unavailable' : (e && e.code) || 'error', message: e && e.message }; };
    return { collection() { return { doc(k) { return {
      async get() { const { data, error } = await T().select('data').eq('user_id', uid).eq('doc', k).maybeSingle(); if (error) fail(error); return { exists: !!data, data: () => data ? data.data : undefined, metadata: { hasPendingWrites: false } }; },
      async set(obj) { const { error } = await T().upsert({ user_id: uid, doc: k, data: obj, updated_at: new Date().toISOString() }, { onConflict: 'user_id,doc' }); if (error) fail(error); },
      async delete() { const { error } = await T().delete().eq('user_id', uid).eq('doc', k); if (error) fail(error); },
      onSnapshot(cb) {                                      // cambios de otros dispositivos: revisa cada 20 s y al volver a la pestaña
        let last = null; const tick = async () => { if (document.hidden) return; try { const s = await this.get(); const js = JSON.stringify(s.data()); if (last !== null && js !== last) cb(s); last = js; } catch (e) { } };
        tick(); setInterval(tick, 20000); document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
        return () => { };
      }
    }; } }; } };
  }
  const downloads = { async save({ filename, data }) { const b = new Blob([data], { type: /\.csv$/.test(filename) ? 'text/csv' : 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); } };

  async function start(session) {
    const uid = session.user.id;
    // Si en este navegador había otra cuenta, su copia local no debe mezclarse con esta.
    try { if (localStorage.getItem('rn-uid') !== uid) { ['sos-real', 'sos-mode', 'sos-demo', 'sos-pend', 'sos-base'].forEach(k => localStorage.removeItem(k)); localStorage.setItem('rn-uid', uid); } } catch (e) { }
    const caps = { db: makeDB(uid), user: { id: async () => uid }, downloads };
    window.claude = { use: async n => caps[n] || null };
    window.RN_WEB = { email: session.user.email, logout,
      history: async () => { try { const { data, error } = await sb.from('rn_history').select('doc,created_at').order('created_at', { ascending: false }).limit(400); if (error) return { error: /relation|does not exist|schema cache/i.test(error.message) ? 'El historial aún no está activado: falta correr supabase_v2.sql en Supabase.' : ERR(error.message) }; return { rows: data || [] }; } catch (e) { return { error: ERR(e && e.message) }; } },
      restore: async at => { try { const { error } = await sb.rpc('rn_restore', { p_at: at }); return error ? { error: ERR(error.message) } : {}; } catch (e) { return { error: ERR(e && e.message) }; } },
      changePassword: async (cur, nw) => {
      try {
        const v = await sb.auth.signInWithPassword({ email: session.user.email, password: cur });   // confirma que eres tú
        if (v.error) return { error: /invalid/i.test(v.error.message) ? 'La contraseña actual no es correcta.' : ERR(v.error.message) };
        const u = await sb.auth.updateUser({ password: nw }); if (u.error) return { error: ERR(u.error.message) };
        return {};
      } catch (e) { return { error: ERR(e && e.message) }; } } };
    if (typeof window.__rnBoot === 'function') window.__rnBoot();
  }
  async function logout() {
    try { await sb.auth.signOut(); } catch (e) { }
    try { ['sos-real', 'sos-mode', 'sos-demo', 'sos-pend', 'sos-base', 'rn-uid'].forEach(k => localStorage.removeItem(k)); } catch (e) { }
    location.replace(location.pathname.replace(/app\.html$/, ''));
  }

  /* ---------- Pantalla de acceso ---------- */
  function screen(mode, msg) {
    let w = $('#rn-auth'); if (!w) { w = document.createElement('div'); w.id = 'rn-auth'; document.body.appendChild(w); }
    const eye = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 10s2.8-5.5 7.5-5.5S17.5 10 17.5 10 14.7 15.5 10 15.5 2.5 10 2.5 10z"/><circle cx="10" cy="10" r="2.3"/></svg>';
    const T = {
      login: ['Bienvenido de vuelta', 'Entra para seguir construyendo tu mejor versión.'],
      reset: ['Recupera tu acceso', 'Te mandamos un enlace a tu correo para crear una contraseña nueva.'],
      newpass: [linkType === 'invite' ? 'Te invitaron a RN.' : 'Crea tu contraseña nueva', linkType === 'invite' ? 'Crea tu contraseña para entrar. Con ella abrirás RN. en cualquier dispositivo.' : 'Elige una contraseña que no uses en otro lado.'],
      signup: ['Crea tu cuenta', 'RN. está en acceso por invitación: usa el correo con el que te invitaron.'],
      confirm: ['Confirma tu correo', 'Te mandamos un enlace para activar tu cuenta. Ábrelo en este mismo dispositivo.'],
      sent: ['Revisa tu correo', 'Si ese correo tiene cuenta, te llegará un enlace en un minuto. Ábrelo en este mismo dispositivo.']
    }[mode];
    const field = (id, type, label, ac, extra = '') => `<label class="au-f"><span>${label}</span><span class="au-in"><input id="${id}" name="${id === 'au-email' ? 'email' : id === 'au-pass' ? 'password' : id}" type="${type}" autocomplete="${ac}" autocapitalize="off" spellcheck="false" required ${extra}>${type === 'password' ? `<button type="button" class="au-eye" data-eye="${id}" aria-label="Mostrar contraseña">${eye}</button>` : ''}</span></label>`;
    let body = '';
    if (mode === 'login') body = `<form id="au-form" method="post" action="#" autocomplete="on">${field('au-email', 'email', 'Correo', 'username', 'inputmode="email"')}${field('au-pass', 'password', 'Contraseña', 'current-password', 'minlength="6"')}
      <button class="au-btn" type="submit"><span>Entrar</span><i class="au-spin"></i></button></form>
      <button class="au-link" data-go="reset">¿Olvidaste tu contraseña?</button>
      <button class="au-link" data-go="signup">¿Te invitaron? <b>Crea tu cuenta</b></button>
      <p class="au-note">RN. está en acceso por invitación. <a href="./#acceso">¿Quieres entrar? Apúntate en la lista de espera</a></p>`;
    if (mode === 'signup') body = `<form id="au-form" method="post" action="#" autocomplete="on">${field('au-email', 'email', 'Correo con el que te invitaron', 'username', 'inputmode="email"')}${field('au-pass', 'password', 'Contraseña', 'new-password', 'minlength="8"')}<div class="au-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></div><small class="au-hint" id="au-hint">Mínimo 8 caracteres. Mejor si mezclas letras, números y símbolos.</small>
      ${field('au-pass2', 'password', 'Repítela', 'new-password', 'minlength="8"')}<button class="au-btn" type="submit"><span>Crear cuenta</span><i class="au-spin"></i></button></form><button class="au-link" data-go="login">Ya tengo cuenta · <b>Entrar</b></button>`;
    if (mode === 'confirm') body = `<div class="au-sent"><div class="au-check">✓</div></div><button class="au-link" data-go="login">← Volver a entrar</button>`;
    if (mode === 'reset') body = `<form id="au-form" method="post" action="#" autocomplete="on">${field('au-email', 'email', 'Correo', 'email', 'inputmode="email"')}<button class="au-btn" type="submit"><span>Mandar enlace</span><i class="au-spin"></i></button></form><button class="au-link" data-go="login">← Volver a entrar</button>`;
    if (mode === 'newpass') body = `<form id="au-form" method="post" action="#" autocomplete="on">${field('au-pass', 'password', 'Contraseña nueva', 'new-password', 'minlength="8"')}<div class="au-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></div><small class="au-hint" id="au-hint">Mínimo 8 caracteres. Mejor si mezclas letras, números y símbolos.</small>
      ${field('au-pass2', 'password', 'Repítela', 'new-password', 'minlength="8"')}<button class="au-btn" type="submit"><span>Guardar y entrar</span><i class="au-spin"></i></button></form>`;
    if (mode === 'sent') body = `<div class="au-sent"><div class="au-check">✓</div></div><button class="au-link" data-go="login">← Volver a entrar</button>`;
    w.innerHTML = `<div class="au-bg" aria-hidden="true"><i></i><i></i><i></i></div><main class="au-card" role="main"><div class="au-mark">${LOGO}</div><h1>${T[0]}</h1><p class="au-sub">${T[1]}</p>
      <p class="au-err" role="alert" ${msg ? '' : 'hidden'}>${msg || ''}</p>${body}</main><p class="au-foot">Build your prime. Right now.</p>`;
    w.classList.remove('out'); requestAnimationFrame(() => w.classList.add('in'));
    const f = $('#au-form'); if (f) { const first = f.querySelector('input'); if (first && matchMedia('(pointer:fine)').matches) first.focus(); f.addEventListener('submit', e => { e.preventDefault(); submit(mode, f); }); }
    const p = $('#au-pass'); if (p && (mode === 'newpass' || mode === 'signup')) p.addEventListener('input', () => meter(p.value));
    if (mode === 'login' || mode === 'reset') { try { const le = localStorage.getItem('rn-last-email'), e = $('#au-email'); if (le && e && !e.value) e.value = le; } catch (x) { } }
    // brillo que sigue al cursor sobre la tarjeta
    const card = w.querySelector('.au-card'); card.addEventListener('pointermove', e => { const r = card.getBoundingClientRect(); card.style.setProperty('--mx', (e.clientX - r.left) + 'px'); card.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
  }
  function meter(v) {
    let s = 0; if (v.length >= 8) s++; if (v.length >= 12) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
    document.querySelectorAll('.au-meter i').forEach((i, k) => i.className = k < s ? 'on s' + s : '');
    const h = $('#au-hint'); if (h) h.textContent = !v ? 'Mínimo 8 caracteres. Mejor si mezclas letras, números y símbolos.' : ['Muy corta', 'Aceptable', 'Buena', 'Muy buena', 'Excelente'][s];
  }
  function setErr(m) { const e = $('.au-err'); if (!e) return; e.textContent = m; e.hidden = !m; const c = $('.au-card'); if (m && c && !RM()) { c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); } }
  function saveCred() {
    try { const e = $('#au-email'), p = $('#au-pass'); if (window.PasswordCredential && e && p && e.value && p.value) navigator.credentials.store(new PasswordCredential({ id: e.value.trim(), password: p.value, name: e.value.trim() })).catch(() => { }); } catch (x) { }
    try { const e = $('#au-email'); if (e && e.value) localStorage.setItem('rn-last-email', e.value.trim()); } catch (x) { }
  }
  function busy(on) { const b = $('.au-btn'); if (b) { b.classList.toggle('busy', on); b.disabled = on; } }
  async function submit(mode, f) {
    setErr(''); busy(true);
    try {
      if (mode === 'login') {
        const { data, error } = await sb.auth.signInWithPassword({ email: $('#au-email').value.trim(), password: $('#au-pass').value });
        if (error) throw error; saveCred(); return enter(data.session);
      }
      if (mode === 'reset') {
        const { error } = await sb.auth.resetPasswordForEmail($('#au-email').value.trim(), { redirectTo: location.origin + location.pathname.replace(/app\.html$/, '') });
        if (error) throw error; busy(false); return screen('sent');
      }
      if (mode === 'signup') {
        const em = $('#au-email').value.trim(), a = $('#au-pass').value, b = $('#au-pass2').value;
        if (a !== b) { busy(false); return setErr('Las contraseñas no coinciden.'); }
        const { data, error } = await sb.auth.signUp({ email: em, password: a, options: { emailRedirectTo: location.origin + location.pathname.replace(/app\.html$/, '') } });
        if (error) throw error;
        if (data && data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw { message: 'already registered' };
        if (data && data.session) { saveCred(); return enter(data.session); }
        busy(false); return screen('confirm');
      }
      if (mode === 'newpass') {
        const a = $('#au-pass').value, b = $('#au-pass2').value;
        if (a !== b) { busy(false); return setErr('Las contraseñas no coinciden.'); }
        const { data, error } = await sb.auth.updateUser({ password: a }); if (error) throw error;
        const { data: s } = await sb.auth.getSession(); return enter(s.session);
      }
    } catch (e) { busy(false); setErr(ERR(e && e.message)); }
  }
  function enter(session) {
    const w = $('#rn-auth');
    if (w) { w.classList.add('out'); setTimeout(() => w.remove(), RM() ? 0 : 520); }
    start(session);
  }
  function showFatal(m) { const s = document.getElementById('rn-splash'); if (s) s.remove(); document.body.insertAdjacentHTML('beforeend', `<div id="rn-auth" class="in"><main class="au-card"><h1>No se pudo abrir RN.</h1><p class="au-sub">${m}</p></main></div>`); }

  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); screen(g.dataset.go); return; }
    const y = e.target.closest('[data-eye]'); if (y) { const i = document.getElementById(y.dataset.eye); if (i) { i.type = i.type === 'password' ? 'text' : 'password'; y.classList.toggle('on', i.type === 'text'); i.focus(); } }
  });

  (async () => {
    let session = null;
    let netFail = false;
    try { const r = await sb.auth.getSession(); session = r.data.session; if (r.error && /fetch|network|failed/i.test(r.error.message || '')) netFail = true; } catch (e) { netFail = true; }
    if (hp.get('access_token') || hp.get('error') || location.hash.includes('access_token')) history.replaceState(null, '', location.pathname + location.search);
    if (linkError) return screen('login', ERR(linkError));
    if (session && (linkType === 'invite' || linkType === 'recovery')) return screen('newpass');
    if (session) return start(session);
    if (/^#crear/.test(hashAtLoad)) { history.replaceState(null, '', location.pathname); return screen('signup'); }
    // Sin internet: la sesión guardada basta para abrir tu copia local; se sincroniza al volver la conexión
    try { const saved = JSON.parse(localStorage.getItem('rn-auth') || 'null'), u = saved && (saved.user || (saved.currentSession && saved.currentSession.user));
      if (u && u.id && (navigator.onLine === false || netFail) && localStorage.getItem('rn-uid') === u.id) return start({ user: u }); } catch (e) { }
    screen('login');
  })();
})();
