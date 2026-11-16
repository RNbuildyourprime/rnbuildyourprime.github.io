// RN. · función "rn-push": manda los recordatorios.
// Se pega en Supabase → Edge Functions → Deploy a new function → Via Editor → nombre: rn-push.
// Después, en la función → Details/Settings: apagar "Enforce JWT verification" (Verify JWT) para que el aviso de cada hora pueda llamarla.
// No necesitas poner claves: Supabase le da a la función su URL y permisos de servidor automáticamente,
// y las llaves de notificaciones se crean solas la primera vez y se guardan en la tabla rn_vapid.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function keys() {
  const { data } = await sb.from("rn_vapid").select("public_key, private_key").eq("id", 1).maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  const row = { id: 1, public_key: k.publicKey, private_key: k.privateKey };
  await sb.from("rn_vapid").upsert(row, { onConflict: "id", ignoreDuplicates: true });
  const { data: again } = await sb.from("rn_vapid").select("public_key, private_key").eq("id", 1).single();
  return again!;
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

async function send(k: any, row: any, msg: any) {
  webpush.setVapidDetails("mailto:avisos@rn.app", k.public_key, k.private_key);
  try { await webpush.sendNotification(row.sub, JSON.stringify(msg), { TTL: 3600, urgency: "normal" }); return true; }
  catch (e: any) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from("rn_push").delete().eq("endpoint", row.endpoint); return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const k = await keys();
  if (req.method === "GET") return json({ publicKey: k.public_key });
  let body: any = {}; try { body = await req.json(); } catch { /* vacío */ }
  if (body.test && body.endpoint) {
    const { data: row } = await sb.from("rn_push").select("*").eq("endpoint", body.endpoint).maybeSingle();
    if (!row) return json({ ok: false, error: "no-sub" }, 404);
    const ok = await send(k, row, { title: "RN.", body: "¡Listo! Así se verán tus recordatorios.", url: "app.html#dashboard", tag: "rn-test" });
    return json({ ok });
  }
  const { data: rows } = await sb.from("rn_push").select("*");
  let sent = 0;
  const cache: Record<string, any> = {};
  for (const row of rows || []) {
    const now = localNow(row.tz || "America/Mexico_City");
    if (!cache[row.user_id]) {
      const { data: d } = await sb.from("rn_docs").select("doc, data").eq("user_id", row.user_id);
      cache[row.user_id] = Object.fromEntries((d || []).map((x: any) => [x.doc, x.data]));
    }
    const msgs = decide(row.prefs, now, cache[row.user_id], row.last_sent || {});
    if (!msgs.length) continue;
    const last = { ...(row.last_sent || {}) };
    for (const m of msgs) { if (await send(k, row, { ...m, tag: "rn-" + m.kind })) { sent++; last[m.kind] = now.date; } }
    await sb.from("rn_push").update({ last_sent: last }).eq("endpoint", row.endpoint);
  }
  return json({ ok: true, subs: (rows || []).length, sent });
});
