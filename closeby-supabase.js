/* =============================================================
   Closeby · conexión con Supabase
   - Entrar con correo + código de 6 dígitos
   - Crear el espacio de la pareja o unirse con un código
   - Perfil inicial
   - Conector de datos con la misma forma que usa la app (doc/collection/onSnapshot)
   ============================================================= */
const SUPABASE_URL = "https://ksmmnyatqoytpkqyrgdh.supabase.co";
const SUPABASE_KEY = "sb_publishable_uGCMy98TswaeJyqh2-mGxg_ByGrgZKJ"; // clave pública (protegida por las reglas RLS)

const lib = window.__supabaseLib || await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
const sb = lib.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "closeby-auth" }
});

/* ---------- utilidades de interfaz ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LOGO = `<svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="M191.54 189.71 A96 96 0 1 1 191.54 66.29 A22 22 0 0 1 157.83 94.58 A52 52 0 1 0 157.83 161.42 A22 22 0 0 1 191.54 189.71 Z"/><circle cx="212" cy="128" r="22" fill="var(--lila)"/></svg>`;

const css = document.createElement("style");
css.textContent = `
#gate{position:fixed;inset:0;z-index:60;background:var(--bg);overflow:auto;-webkit-overflow-scrolling:touch;display:flex;justify-content:center}
#gate .g-wrap{width:100%;max-width:440px;padding:calc(28px + env(safe-area-inset-top)) 22px calc(28px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:16px}
#gate .g-brand{display:flex;align-items:center;gap:8px;font-family:"Outfit",var(--font);font-weight:600;font-size:24px;letter-spacing:-.03em}
#gate .g-brand svg{width:34px;height:34px;color:var(--ink)}
#gate h1{font-size:34px;font-weight:300;letter-spacing:-.035em;line-height:1.05;margin:18px 0 0}
#gate h1 b{font-weight:700}
#gate p.lead{margin:0;color:var(--muted);font-size:15px;line-height:1.45}
#gate .g-card{background:var(--card);border-radius:24px;padding:18px;display:flex;flex-direction:column;gap:14px}
#gate .g-err{color:var(--bad);font-size:14px;margin:0;min-height:1em}
#gate .g-row{display:flex;gap:10px;flex-wrap:wrap}
#gate .g-opt{border:0;text-align:left;background:var(--card);border-radius:22px;padding:18px;display:flex;flex-direction:column;gap:4px;color:var(--ink);font:inherit;cursor:pointer;transition:transform 160ms var(--ease)}
#gate .g-opt:active{transform:scale(.98)}
#gate .g-opt b{font-size:18px;font-weight:600}
#gate .g-opt span{color:var(--muted);font-size:14px}
#gate .g-code{font-family:"Outfit",var(--font);font-size:44px;font-weight:600;letter-spacing:.06em;text-align:center;padding:18px;border-radius:20px;background:var(--lime);color:var(--on-lime);user-select:all;-webkit-user-select:all}
#gate .g-otp{font-size:28px!important;letter-spacing:.3em;text-align:center;font-variant-numeric:tabular-nums}
#gate .g-link{background:none;border:0;color:var(--lila);font:inherit;font-size:14px;font-weight:500;padding:6px 0;cursor:pointer;align-self:flex-start}
#gate .g-spin{width:28px;height:28px;border-radius:50%;border:3px solid var(--chip);border-top-color:var(--lila);animation:gspin .8s linear infinite;margin:40px auto}
@keyframes gspin{to{transform:rotate(360deg)}}
`;
document.head.appendChild(css);

let gate = null;
function showGate(html) {
  if (window.__cb && window.__cb.hideSplash) window.__cb.hideSplash();
  if (!gate) { gate = document.createElement("div"); gate.id = "gate"; document.body.appendChild(gate); }
  gate.innerHTML = `<div class="g-wrap"><div class="g-brand">${LOGO}<span>closeby</span></div>${html}</div>`;
  gate.scrollTop = 0;
  return gate;
}
function hideGate() { if (gate) { gate.remove(); gate = null; } }
function busy(btn, on, label) { if (!btn) return; btn.disabled = on; if (label) btn.textContent = label; }

function niceAuthError(e) {
  const m = (e && (e.message || e.error_description || "")) + "";
  if (/rate|too many|seconds/i.test(m)) return "Espera un minuto antes de pedir otro código.";
  if (/expired|invalid|token/i.test(m)) return "Ese código no es válido o ya venció. Pide uno nuevo.";
  if (/email/i.test(m) && /valid/i.test(m)) return "Revisa que el correo esté bien escrito.";
  if (/fetch|network|failed/i.test(m)) return "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
  return m || "Algo salió mal. Inténtalo de nuevo.";
}
function niceDbError(e) {
  const m = (e && e.message) || "";
  return m.replace(/^.*?ERROR:\s*/, "") || "Algo salió mal. Inténtalo de nuevo.";
}

/* ---------- 1. Entrar con correo + contraseña ---------- */
function loginScreen(prefill = "", mode = "login") {
  return new Promise(resolve => {
    const isNew = mode === "signup";
    const g = showGate(`
      <h1>Lejos en el mapa,<br><b>cerca en todo</b></h1>
      <svg class="illo" aria-hidden="true" focusable="false" style="width:min(260px,80%)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g transform="translate(20 0)"><path d="M106 96 Q180 130 254 96" fill="none" stroke="#141317" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/><g transform="translate(62 180) scale(1 1)" stroke="#141317" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M-18 -22 V0 M18 -22 V0" fill="none"/><path d="M-46 -50 L-64 -24" fill="none"/><path d="M46 -50 L52 -84" fill="none"/><path d="M0 -108 C2 -116 6 -122 10 -126" fill="none"/><circle cx="11" cy="-130" r="8" fill="#D5F542"/><path d="M0 -108 C34 -108 52 -84 52 -58 C52 -32 34 -16 0 -16 C-34 -16 -52 -32 -52 -58 C-52 -84 -34 -108 0 -108 Z" fill="#C9B8FF"/><circle cx="-11" cy="-64" r="5.5" fill="#141317" stroke="none"/><circle cx="19" cy="-64" r="5.5" fill="#141317" stroke="none"/></g><g stroke="#141317" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M96 80 h20 v32 h-20 Z" fill="#D5F542"/></g><g transform="translate(298 180) scale(-1 1)" stroke="#141317" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M-18 -22 V0 M18 -22 V0" fill="none"/><path d="M-46 -50 L-64 -24" fill="none"/><path d="M46 -50 L52 -84" fill="none"/><path d="M0 -108 C2 -116 6 -122 10 -126" fill="none"/><circle cx="11" cy="-130" r="8" fill="#D5F542"/><path d="M0 -108 C34 -108 52 -84 52 -58 C52 -32 34 -16 0 -16 C-34 -16 -52 -32 -52 -58 C-52 -84 -34 -108 0 -108 Z" fill="#C9B8FF"/><circle cx="-11" cy="-64" r="5.5" fill="#141317" stroke="none"/><circle cx="19" cy="-64" r="5.5" fill="#141317" stroke="none"/></g><g stroke="#141317" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M264 80 h-20 v32 h20 Z" fill="#D5F542"/></g></g></svg>
      <div class="seg" role="tablist" style="margin:0"><button type="button" role="tab" aria-pressed="${!isNew}" id="g-tlog">Entrar</button><button type="button" role="tab" aria-pressed="${isNew}" id="g-tnew">Crear cuenta</button></div>
      <form class="g-card" id="g-auth">
        <div class="field"><label for="g-mail">Correo</label>
          <input id="g-mail" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" required placeholder="tu@correo.com" value="${esc(prefill)}"></div>
        <div class="field"><label for="g-pass">Contraseña</label>
          <input id="g-pass" type="password" autocomplete="${isNew ? "new-password" : "current-password"}" required minlength="6" placeholder="${isNew ? "Mínimo 6 caracteres" : "Tu contraseña"}"></div>
        <label class="small muted" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="g-show" style="width:auto;min-height:0"> Mostrar contraseña</label>
        <p class="g-err" id="g-err"></p>
        <button class="btn block" type="submit" id="g-go">${isNew ? "Crear mi cuenta" : "Entrar"}</button>
      </form>`);
    const err = $("#g-err", g), btn = $("#g-go", g), pass = $("#g-pass", g);
    $("#g-show", g).onchange = e => { pass.type = e.target.checked ? "text" : "password"; };
    $("#g-tlog", g).onclick = () => resolve(loginScreen($("#g-mail", g).value, "login"));
    $("#g-tnew", g).onclick = () => resolve(loginScreen($("#g-mail", g).value, "signup"));
    $("#g-auth", g).onsubmit = async e => {
      e.preventDefault(); err.textContent = "";
      const email = $("#g-mail", g).value.trim().toLowerCase(), password = pass.value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = "Revisa que el correo esté bien escrito."; return; }
      if (password.length < 6) { err.textContent = "La contraseña necesita al menos 6 caracteres."; return; }
      busy(btn, true, isNew ? "Creando…" : "Entrando…");
      const res = isNew ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
      const { data, error } = res;
      if (error) {
        busy(btn, false, isNew ? "Crear mi cuenta" : "Entrar");
        const m = (error.message || "") + "";
        err.textContent = /invalid login|invalid credentials/i.test(m) ? "Correo o contraseña incorrectos."
          : /already registered|already exists/i.test(m) ? "Ya existe una cuenta con ese correo. Toca «Entrar»."
          : /not confirmed/i.test(m) ? "Falta confirmar el correo. Revisa tu bandeja de entrada (y spam)."
          : niceAuthError(error);
        return;
      }
      if (!data || !data.session) { busy(btn, false, isNew ? "Crear mi cuenta" : "Entrar"); err.style.color = "var(--ink)"; err.textContent = "Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego vuelve aquí y toca «Entrar»."; return; }
      resolve(data.session);
    };
  });
}
/* ---------- 2. Crear el espacio o unirse con un código ---------- */
function connectScreen() {
  return new Promise(resolve => {
    const g = showGate(`
      <h1>Conecta con <b>tu pareja</b></h1>
      <p class="lead">Una crea el espacio y le pasa un código a la otra. Así solo ustedes dos ven lo que comparten.</p>
      <button class="g-opt" type="button" id="g-new"><b>Crear nuestro espacio</b><span>Soy la primera en entrar. Me darán un código para compartir.</span></button>
      <form class="g-card" id="g-join">
        <div class="field"><label for="g-inv">Tengo un código de mi pareja</label>
          <input id="g-inv" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="CB-XXXX" maxlength="12" style="text-transform:uppercase;letter-spacing:.08em"></div>
        <p class="g-err" id="g-err"></p>
        <button class="btn block" type="submit" id="g-joinbtn">Unirme</button>
      </form>
      <button class="g-link" type="button" id="g-out">Salir de esta cuenta</button>`);
    const err = $("#g-err", g);
    $("#g-out", g).onclick = async () => { await sb.auth.signOut(); location.reload(); };
    $("#g-new", g).onclick = async e => {
      const b = e.currentTarget; b.disabled = true; b.style.opacity = .6;
      const { data, error } = await sb.rpc("create_couple");
      if (error) { b.disabled = false; b.style.opacity = 1; err.textContent = niceDbError(error); return; }
      resolve({ ...data, justCreated: true });
    };
    $("#g-join", g).onsubmit = async e => {
      e.preventDefault(); err.textContent = "";
      const code = $("#g-inv", g).value.trim();
      if (code.replace(/[^a-z0-9]/gi, "").length < 4) { err.textContent = "Escribe el código completo, por ejemplo CB-7K4P."; return; }
      const btn = $("#g-joinbtn", g); busy(btn, true, "Conectando…");
      const { data, error } = await sb.rpc("join_couple", { p_code: code });
      if (error) { busy(btn, false, "Unirme"); err.textContent = niceDbError(error); return; }
      resolve({ ...data, justJoined: true });
    };
  });
}

/* ---------- 3. Perfil inicial ---------- */
function profileScreen(slot, store, writeDoc) {
  return new Promise(resolve => {
    const cfg = store.get("app/config") || {};
    const mine = cfg[slot] || {}, other = cfg[slot === "p1" ? "p2" : "p1"] || {};
    const cities = (window.__cb && window.__cb.CITIES) || [["America/Lima", "Lima (Perú)"]];
    const colors = (window.__cb && window.__cb.PERSON_COLORS) || [];
    let tz = mine.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!cities.some(c => c[0] === tz)) tz = cities[0][0];
    const guessCur = tz === "America/Lima" ? "PEN" : (tz.startsWith("America/") && ["Vancouver","Edmonton","Regina","Winnipeg","Toronto","Halifax","St_Johns"].some(x => tz.endsWith(x))) ? "CAD" : "USD";
    let color = mine.color || colors.find(c => c[0] !== other.color)?.[0] || "";
    const g = showGate(`
      <h1>Cuéntanos <b>de ti</b></h1>
      <p class="lead">Esto lo verá tu pareja. Puedes cambiarlo cuando quieras desde tu perfil.</p>
      <form class="g-card" id="g-prof">
        <div class="field"><label for="g-name">Tu nombre</label><input id="g-name" maxlength="24" autocomplete="given-name" required value="${esc(mine.name && mine.setup ? mine.name : "")}" placeholder="Cómo quieres que te llame"></div>
        <div class="field"><label for="g-tz">Dónde vives</label><select id="g-tz">${cities.map(([v, l]) => `<option value="${v}"${v === tz ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div class="field"><label for="g-cur">Tu moneda</label><select id="g-cur">
          <option value="PEN"${guessCur === "PEN" ? " selected" : ""}>Soles (S/)</option>
          <option value="CAD"${guessCur === "CAD" ? " selected" : ""}>Dólares canadienses (C$)</option>
          <option value="USD"${guessCur === "USD" ? " selected" : ""}>Dólares estadounidenses (US$)</option></select></div>
        ${colors.length ? `<div class="field"><span class="lab">Tu color</span><div class="colpick">${colors.map(([k, l, c]) => `<button type="button" class="colsw" data-col="${k}" aria-label="${l}" aria-pressed="${k === color}" ${k === other.color ? "disabled" : ""} style="--sw:${c}"></button>`).join("")}</div></div>` : ""}
        <p class="g-err" id="g-err"></p>
        <button class="btn block" type="submit" id="g-save">Empezar</button>
      </form>`);
    g.querySelectorAll("[data-col]").forEach(b => b.onclick = () => { color = b.dataset.col; g.querySelectorAll("[data-col]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
    $("#g-tz", g).onchange = e => { const v = e.target.value; $("#g-cur", g).value = v === "America/Lima" ? "PEN" : ["Vancouver","Edmonton","Regina","Winnipeg","Toronto","Halifax","St_Johns"].some(x => v.endsWith(x)) ? "CAD" : "USD"; };
    $("#g-prof", g).onsubmit = async e => {
      e.preventDefault();
      const name = $("#g-name", g).value.trim(), err = $("#g-err", g), btn = $("#g-save", g);
      if (!name) { err.textContent = "Escribe tu nombre."; return; }
      busy(btn, true, "Guardando…");
      const fresh = store.get("app/config") || {};
      const part = { ...(fresh[slot] || {}), name, tz: $("#g-tz", g).value, cur: $("#g-cur", g).value, setup: true };
      if (color) part.color = color;
      try { await writeDoc("app/config", { ...fresh, [slot]: part }); resolve(); }
      catch (x) { busy(btn, false, "Empezar"); err.textContent = "No se pudo guardar. Revisa tu conexión."; }
    };
  });
}

/* ---------- 4. Compartir el código ---------- */
function shareCodeScreen(code) {
  return new Promise(resolve => {
    const text = `Únete a nuestro espacio en Closeby con este código: ${code}\n${location.origin}`;
    const g = showGate(`
      <h1>Tu código <b>de pareja</b></h1>
      <p class="lead">Mándaselo a tu pareja. Ella crea su cuenta, elige «Tengo un código» y lo escribe. Sirve una sola vez y vence en 24 horas.</p>
      <div class="g-code" id="g-c">${esc(code)}</div>
      <div class="g-row"><button class="btn" type="button" id="g-share" style="flex:1">Compartir</button><button class="btn ghost" type="button" id="g-copy" style="flex:1">Copiar</button></div>
      <p class="lead small" id="g-msg" style="min-height:1em"></p>
      <button class="btn limebtn block" type="button" id="g-go">Entrar a Closeby</button>
      <p class="lead" style="font-size:13px">También lo encuentras después en Perfil → Ajustes.</p>`);
    $("#g-share", g).onclick = async () => { try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); $("#g-msg", g).textContent = "Copiado. Pégalo en WhatsApp."; } } catch (_) {} };
    $("#g-copy", g).onclick = async () => { try { await navigator.clipboard.writeText(code); $("#g-msg", g).textContent = "Código copiado."; } catch (_) { $("#g-msg", g).textContent = "Mantén presionado el código para copiarlo."; } };
    $("#g-go", g).onclick = () => resolve();
  });
}

/* ---------- Conector de datos (misma forma que usa la app) ---------- */
function makeStore(coupleId) {
  const store = new Map();
  const subs = new Set();
  let pending = false;
  const notify = () => { if (pending) return; pending = true; queueMicrotask(() => { pending = false; subs.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }); };
  const clone = d => (d == null ? d : JSON.parse(JSON.stringify(d)));

  async function loadAll() {
    const next = new Map(); let from = 0; const size = 1000;
    for (;;) {
      const { data, error } = await sb.from("docs").select("path,data").eq("couple_id", coupleId).range(from, from + size - 1);
      if (error) throw error;
      data.forEach(r => next.set(r.path, r.data));
      if (data.length < size) break;
      from += size;
    }
    store.clear(); next.forEach((v, k) => store.set(k, v)); notify();
  }
  async function writeDoc(path, data) {
    const prev = store.has(path) ? store.get(path) : undefined;
    store.set(path, clone(data)); notify();
    const { error } = await sb.from("docs").upsert({ couple_id: coupleId, path, data, updated_at: new Date().toISOString() }, { onConflict: "couple_id,path" });
    if (error) { if (prev === undefined) store.delete(path); else store.set(path, prev); notify(); throw dbErr(error); }
  }
  async function deleteDoc(path) {
    const prev = store.get(path); store.delete(path); notify();
    const { error } = await sb.from("docs").delete().eq("couple_id", coupleId).eq("path", path);
    if (error) { if (prev !== undefined) store.set(path, prev); notify(); throw dbErr(error); }
  }
  function dbErr(e) { const x = new Error(e.message || "error"); x.code = e.code === "42501" ? "permission_denied" : (e.code || "unknown"); return x; }

  const snapDoc = p => ({ id: p.split("/").pop(), exists: store.has(p), data: () => clone(store.get(p)), metadata: { fromCache: false, hasPendingWrites: false } });
  const inColl = c => [...store.keys()].filter(p => p.startsWith(c + "/") && !p.slice(c.length + 1).includes("/")).sort();
  const snapColl = c => { const docs = inColl(c).map(snapDoc); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false } }; };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const listen = f => { subs.add(f); setTimeout(f, 0); return () => subs.delete(f); };

  function docRef(p) {
    return {
      id: p.split("/").pop(), path: p,
      get: async () => snapDoc(p),
      set: async d => writeDoc(p, d),
      update: async d => writeDoc(p, { ...(store.get(p) || {}), ...d }),
      delete: async () => deleteDoc(p),
      onSnapshot: (n, onErr) => listen(() => n(snapDoc(p))),
      collection: c => collRef(p + "/" + c)
    };
  }
  function collRef(c) {
    return {
      path: c,
      doc: id => docRef(c + "/" + (id || newId())),
      add: async d => { const r = docRef(c + "/" + newId()); await r.set(d); return r; },
      onSnapshot: (n, onErr) => listen(() => n(snapColl(c))),
      get: async () => snapColl(c),
      where() { return this; }, orderBy() { return this; }, limit() { return this; }
    };
  }

  // Tiempo real + resincronizar al volver a la app (iOS corta la conexión en segundo plano)
  let channel = null;
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("docs-" + coupleId)
      .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "couple_id=eq." + coupleId }, pl => {
        if (pl.eventType === "DELETE") { const o = pl.old || {}; if (o.path && (!o.couple_id || o.couple_id === coupleId)) store.delete(o.path); }
        else { const n = pl.new; if (n && n.couple_id === coupleId) store.set(n.path, n.data); }
        notify();
      })
      .subscribe();
  }
  let lastSync = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastSync > 5000) { lastSync = Date.now(); loadAll().catch(() => {}); subscribe(); }
  });
  window.addEventListener("online", () => { loadAll().catch(() => {}); subscribe(); });

  return { db: { doc: docRef, collection: collRef }, store, loadAll, subscribe, writeDoc };
}

/* ---------- Descargas (exportar CSV, ícono) ---------- */
const downloads = {
  async save({ filename, data }) {
    const type = /\.png$/i.test(filename) ? "image/png" : /\.csv$/i.test(filename) ? "text/csv" : "application/octet-stream";
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const file = typeof File === "function" ? new File([blob], filename, { type }) : null;
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return { status: "saved" }; }
    } catch (e) { if (e && e.name === "AbortError") throw { code: "declined" }; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return { status: "saved" };
  }
};

/* ---------- Arranque ---------- */
async function boot() {
  showGate(`<div class="g-spin" role="status" aria-label="Cargando"></div>`);
  let session = (await sb.auth.getSession()).data.session;
  if (!session) session = await loginScreen();
  const uid = session.user.id;

  showGate(`<div class="g-spin" role="status" aria-label="Cargando"></div>`);
  let mem = null;
  {
    const { data, error } = await sb.rpc("my_membership");
    if (error) { showGate(`<h1>Sin <b>conexión</b></h1><p class="lead">${esc(niceDbError(error))}</p><button class="btn block" onclick="location.reload()">Reintentar</button>`); return; }
    mem = data;
  }
  let fresh = null;
  if (!mem) { fresh = await connectScreen(); mem = { couple_id: fresh.couple_id, slot: fresh.slot, partner_joined: !!fresh.justJoined, code: fresh.code }; }

  const S = makeStore(mem.couple_id);
  try { await S.loadAll(); } catch (e) { showGate(`<h1>Sin <b>conexión</b></h1><p class="lead">No pudimos traer sus datos. Revisa tu internet.</p><button class="btn block" onclick="location.reload()">Reintentar</button>`); return; }
  S.subscribe();

  const cfg = S.store.get("app/config") || {};
  if (!(cfg[mem.slot] && cfg[mem.slot].setup)) await profileScreen(mem.slot, S.store, S.writeDoc);
  if (mem.slot === "p1" && !mem.partner_joined && fresh && fresh.code) await shareCodeScreen(fresh.code);

  // Lo que la app necesita (misma interfaz que antes)
  const user = { id: async () => uid, isOwner: () => mem.slot === "p1", email: session.user.email };
  window.claude = { use: async n => n === "db" ? S.db : n === "user" ? user : n === "downloads" ? downloads : null };
  window.closeby = {
    email: session.user.email,
    membership: async () => { const { data } = await sb.rpc("my_membership"); return data; },
    newInvite: async () => { const { data, error } = await sb.rpc("new_invite"); if (error) throw new Error(niceDbError(error)); return data; },
    signOut: async () => { try { await sb.auth.signOut(); } catch (_) {} localStorage.removeItem("closeby-auth"); location.reload(); }
  };
  sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") location.reload(); });
  hideGate();
  if (typeof window.__startCloseby === "function") window.__startCloseby();
}
boot().catch(e => { console.error(e); showGate(`<h1>Algo <b>falló</b></h1><p class="lead">${esc(e && e.message || e)}</p><button class="btn block" onclick="location.reload()">Reintentar</button>`); });
