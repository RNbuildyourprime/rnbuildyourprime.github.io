-- RN. · recordatorios y estadísticas de la página (v3)
-- Pegar COMPLETO en Supabase → SQL Editor → New query → Run. Se puede correr más de una vez sin problema.
-- No toca tus datos: solo agrega tablas, reglas y una tarea programada.

/* ============ 1. Recordatorios (notificaciones) ============
   Cada teléfono o compu donde actives recordatorios guarda aquí su "dirección" de notificaciones y tus horarios.
   Solo tú ves y cambias las tuyas. */
create table if not exists public.rn_push (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  sub        jsonb not null,
  tz         text not null default 'America/Mexico_City',
  prefs      jsonb not null default '{}'::jsonb,
  last_sent  jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rn_push_user on public.rn_push (user_id);
alter table public.rn_push enable row level security;
drop policy if exists "rn_push_propio" on public.rn_push;
create policy "rn_push_propio" on public.rn_push for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.rn_push from anon;
grant select, insert, update, delete on public.rn_push to authenticated;

-- Llaves de notificaciones: la función rn-push las crea sola la primera vez. Nadie las lee desde la página.
create table if not exists public.rn_vapid (
  id          int primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);
alter table public.rn_vapid enable row level security;   -- sin reglas: solo la función (con permisos de servidor) la usa
revoke all on public.rn_vapid from anon, authenticated;
-- La función rn-push trabaja con permisos de servidor (service_role): necesita poder leer y escribir aquí.
grant select, insert, update on public.rn_vapid to service_role;
grant select, insert, update, delete on public.rn_push to service_role;
grant select on public.rn_docs to service_role;

-- Aviso cada hora a la función rn-push (ella decide a quién le toca según su hora y horarios).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin perform cron.unschedule('rn-push'); exception when others then null; end $$;
select cron.schedule('rn-push', '0 * * * *',
  $$ select net.http_post(
       url := 'https://ncxsduzkbaeysaegpuzb.supabase.co/functions/v1/rn-push',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"run":true}'::jsonb) $$);

/* ============ 2. Estadísticas de la página de bienvenida ============
   Sin cookies y sin datos personales: solo qué página, de dónde llegaron (el sitio, no la persona),
   si es celular o compu, y clics en "lista de espera" / "crear cuenta" / "iniciar sesión". */
create table if not exists public.rn_visits (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  event  text not null default 'view',
  path   text,
  ref    text,
  utm    text,
  device text,
  constraint rn_visits_event check (event in ('view','waitlist','signup_click','login_click','invite_click')),
  constraint rn_visits_len check (coalesce(char_length(path),0) <= 120 and coalesce(char_length(ref),0) <= 120 and coalesce(char_length(utm),0) <= 120 and coalesce(char_length(device),0) <= 20)
);
create index if not exists rn_visits_at on public.rn_visits (at desc);
alter table public.rn_visits enable row level security;
drop policy if exists "rn_visits_registrar" on public.rn_visits;
create policy "rn_visits_registrar" on public.rn_visits for insert to anon, authenticated with check (true);
revoke all on public.rn_visits from anon, authenticated;
grant insert on public.rn_visits to anon, authenticated;
grant usage on sequence public.rn_visits_id_seq to anon, authenticated;

-- Quién puede ver las estadísticas dentro de la app (tú). Agrégate con el paso de abajo.
create table if not exists public.rn_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.rn_admins enable row level security;
revoke all on public.rn_admins from anon, authenticated;

create or replace function public.rn_stats(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
begin
  if me is null or not exists (select 1 from rn_admins where user_id = me) then return null; end if;
  return jsonb_build_object(
    'days', p_days,
    'views', (select count(*) from rn_visits where event = 'view' and at >= since),
    'views7', (select count(*) from rn_visits where event = 'view' and at >= now() - interval '7 days'),
    'signup_click', (select count(*) from rn_visits where event = 'signup_click' and at >= since),
    'login_click', (select count(*) from rn_visits where event = 'login_click' and at >= since),
    'waitlist', (select count(*) from rn_waitlist where created_at >= since),
    'waitlist_total', (select count(*) from rn_waitlist),
    'mobile', (select count(*) from rn_visits where event = 'view' and device = 'móvil' and at >= since),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d) from (select (at at time zone 'America/Mexico_City')::date d, count(*) n from rn_visits where event = 'view' and at >= since group by 1) x), '[]'::jsonb),
    'refs', coalesce((select jsonb_agg(jsonb_build_object('ref', ref, 'n', n) order by n desc) from (select coalesce(nullif(ref,''),'Directo') ref, count(*) n from rn_visits where event = 'view' and at >= since group by 1 order by 2 desc limit 6) x), '[]'::jsonb)
  );
end $$;
revoke all on function public.rn_stats(int) from public, anon;
grant execute on function public.rn_stats(int) to authenticated;

-- Hazte administrador (corre esta línea cambiando el correo por el tuyo; solo una vez):
-- insert into public.rn_admins (user_id) select id from auth.users where email = 'TU_CORREO_AQUI' on conflict do nothing;
