// RN. · función "rn-push": manda los recordatorios.
// Se pega en Supabase → Edge Functions → (rn-push) → Code → reemplazar todo → Deploy.
// Apagar "Enforce JWT verification" en la configuración de la función.
// No necesitas poner claves: Supabase le da a la función su URL y permisos de servidor automáticamente,
// y las llaves de notificaciones se crean solas la primera vez y se guardan en la tabla rn_vapid.
// Todo el cifrado usa WebCrypto (estándar), sin librerías externas de notificaciones.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
let _sb: any = null;
const db = () => _sb || (_sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } }));

// ---- utilidades base64url ----
const b64u = (a: Uint8Array) => btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => { const p = "=".repeat((4 - (s.length % 4)) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const cat = (...xs: Uint8Array[]) => { const o = new Uint8Array(xs.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of xs) { o.set(x, i); i += x.length; } return o; };
const enc = new TextEncoder();

// ---- llaves VAPID (se guardan como JWK) ----
export async function newVapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { public_key: b64u(pub), private_key: JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }) };
}
async function keys() {
  const { data, error } = await db().from("rn_vapid").select("public_key, private_key").eq("id", 1).maybeSingle();
  if (error) throw new Error("rn_vapid: " + error.message);
  if (data) return data;
  const k = await newVapid();
  await db().from("rn_vapid").upsert({ id: 1, ...k }, { onConflict: "id", ignoreDuplicates: true });
  const { data: again, error: e2 } = await db().from("rn_vapid").select("public_key, private_key").eq("id", 1).single();
  if (e2) throw new Error("rn_vapid: " + e2.message);
  return again;
}
async function signKey(k: { public_key: string; private_key: string }) {
  let jwk: any;
  if (k.private_key.trim().startsWith("{")) jwk = JSON.parse(k.private_key);
  else { const p = unb64u(k.public_key); jwk = { kty: "EC", crv: "P-256", x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), d: k.private_key }; }
  return crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}
export async function vapidAuth(endpoint: string, k: { public_key: string; private_key: string }) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000);
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))), c = b64u(enc.encode(JSON.stringify({ aud, exp: now + 12 * 3600, sub: "mailto:avisos@rn.app" })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signKey(k), enc.encode(h + "." + c)));
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${k.public_key}`;
}

// ---- cifrado del mensaje (RFC 8291, aes128gcm) ----
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}
export async function encrypt(sub: { keys: { p256dh: string; auth: string } }, text: string) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, secret, cat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function push(row: any, k: any, msg: unknown) {
  const body = await encrypt(row.sub, JSON.stringify(msg));
  const r = await fetch(row.sub.endpoint || row.endpoint, { method: "POST", headers: { Authorization: await vapidAuth(row.endpoint, k), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "3600", Urgency: "normal" }, body });
  if (r.status === 404 || r.status === 410) await db().from("rn_push").delete().eq("endpoint", row.endpoint);
  return { ok: r.ok, status: r.status, text: r.ok ? "" : (await r.text()).slice(0, 200) };
}

// ---- fechas en la zona horaria de cada quien ----
function localNow(tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`, dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday);
  return { date, hour: +p.hour, dow, day: +p.day };
}
const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const list = (a: string[]) => a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " y " + a[a.length - 1];

export function decide(prefs: any, now: { date: string; hour: number; dow: number; day: number }, docs: any, last: any) {
  const out: { kind: string; title: string; body: string; url: string }[] = [];
  if (!prefs || prefs.on === false) return out;
  const meta = docs.meta || {}, habits = (docs.habits && docs.habits.items) || [], reviews = (docs.reviews && docs.reviews.items) || [];
  const pauses = (meta.pauses || []).filter((p: any) => p.start <= now.date && (!p.end || p.end >= now.date));
  if (pauses.length && prefs.pauseMute !== false) return out;
  const wk = addDays(now.date, -now.dow), h = (k: string, def: number) => (prefs[k] && prefs[k].h != null ? +prefs[k].h : def), on = (k: string, def: boolean) => (prefs[k] && prefs[k].on != null ? !!prefs[k].on : def);
  const due = (k: string, def: number, d: boolean) => on(k, d) && now.hour === h(k, def) && last[k] !== now.date;
  if (due("habits", 20, true)) {
    const daysLeft = 7 - now.dow, names: string[] = [];
    habits.filter((x: any) => !x.archived).forEach((x: any) => {
      const logs = x.logs || [], T = (x.adj && +x.adj[wk]) || +x.target || 1;
      if (logs.some((l: any) => l.date === now.date)) return;
      const n = logs.filter((l: any) => l.date >= wk && l.date <= now.date).length, need = T - n;
      if (need > 0 && (T >= 5 || need >= daysLeft - 1)) names.push(x.title);
    });
    if (names.length) out.push({ kind: "habits", title: "RN.", body: `Te ${names.length > 1 ? "faltan" : "falta"} ${list(names.slice(0, 3))}${names.length > 3 ? ` y ${names.length - 3} más` : ""} para hoy. Un toque y listo.`, url: "app.html#quick" });
  }
  if (now.dow === 6 && due("review", 19, true)) {
    const r = reviews.find((x: any) => x.period === wk);
    if (!(r && r.done)) out.push({ kind: "review", title: "Cierra tu semana", body: "3 minutos: qué salió bien, qué ajustas y tus 3 prioridades.", url: "app.html#cierre" });
  }
  if (now.day === 1 && due("wrap", 10, false)) {
    const m = +now.date.slice(5, 7) - 2, name = MES[(m + 12) % 12];
    out.push({ kind: "wrap", title: `Tu resumen de ${name} está listo`, body: "Tu XP, tu constancia y tu hábito estrella del mes.", url: "app.html#resumen" });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const k = await keys();
    if (req.method === "GET") return json({ ok: true, publicKey: k.public_key });
    let body: any = {}; try { body = await req.json(); } catch { /* vacío */ }
    if (body.test && body.endpoint) {
      const { data: row } = await db().from("rn_push").select("*").eq("endpoint", body.endpoint).maybeSingle();
      if (!row) return json({ ok: false, error: "Este dispositivo no está registrado" }, 404);
      const r = await push(row, k, { title: "RN.", body: "¡Listo! Así se verán tus recordatorios.", url: "app.html#dashboard", tag: "rn-test" });
      return json(r, r.ok ? 200 : 502);
    }
    const { data: rows } = await db().from("rn_push").select("*");
    let sent = 0; const cache: Record<string, any> = {};
    for (const row of rows || []) {
      const now = localNow(row.tz || "America/Mexico_City");
      if (!cache[row.user_id]) { const { data: d } = await db().from("rn_docs").select("doc, data").eq("user_id", row.user_id); cache[row.user_id] = Object.fromEntries((d || []).map((x: any) => [x.doc, x.data])); }
      const msgs = decide(row.prefs, now, cache[row.user_id], row.last_sent || {});
      if (!msgs.length) continue;
      const last = { ...(row.last_sent || {}) };
      for (const m of msgs) { const r = await push(row, k, { ...m, tag: "rn-" + m.kind }); if (r.ok) { sent++; last[m.kind] = now.date; } }
      await db().from("rn_push").update({ last_sent: last }).eq("endpoint", row.endpoint);
    }
    return json({ ok: true, subs: (rows || []).length, sent });
  } catch (e) {
    return json({ ok: false, error: String((e && (e as Error).message) || e) }, 500);
  }
});
