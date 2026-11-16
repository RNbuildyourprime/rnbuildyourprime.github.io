-- RN. · mejoras de datos y cuentas (v2)
-- Pegar COMPLETO en Supabase → SQL Editor → New query → Run. Se puede correr más de una vez sin problema.
-- No toca tus datos: solo agrega tablas y reglas nuevas.

/* ============ 1. Historial de versiones ============
   Cada vez que una sección de tus datos cambia, se guarda cómo estaba antes (máx. una copia cada 10 min por sección).
   Se conservan 30 días. Desde Ajustes → Datos puedes volver a cómo estaba todo en cualquier momento. */
create table if not exists public.rn_history (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  doc        text not null,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists rn_history_user_time on public.rn_history (user_id, created_at desc);
alter table public.rn_history enable row level security;
drop policy if exists "rn_history_ver_propio" on public.rn_history;
create policy "rn_history_ver_propio" on public.rn_history for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.rn_history from anon;
grant select on public.rn_history to authenticated;

create or replace function public.rn_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rn_history h where h.user_id = old.user_id and h.doc = old.doc and h.created_at > now() - interval '10 minutes') then
    insert into rn_history (user_id, doc, data) values (old.user_id, old.doc, old.data);
  end if;
  delete from rn_history h where h.user_id = old.user_id and h.doc = old.doc and h.created_at < now() - interval '30 days';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists rn_docs_snapshot on public.rn_docs;
create trigger rn_docs_snapshot before update or delete on public.rn_docs for each row execute function public.rn_snapshot();

-- Volver a cómo estaba todo en un momento: cada sección toma la primera copia guardada desde ese momento.
-- Antes de restaurar guarda una copia de cómo está ahora, para poder deshacerlo.
create or replace function public.rn_restore(p_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare d text; v jsonb; me uuid := auth.uid();
begin
  if me is null then raise exception 'sin sesión'; end if;
  insert into rn_history (user_id, doc, data) select user_id, doc, data from rn_docs where user_id = me;
  foreach d in array array['meta','goals','habits','tasks','reviews'] loop
    select h.data into v from rn_history h where h.user_id = me and h.doc = d and h.created_at >= p_at order by h.created_at asc limit 1;
    if v is not null then
      insert into rn_docs (user_id, doc, data, updated_at) values (me, d, v, now())
      on conflict (user_id, doc) do update set data = excluded.data, updated_at = now();
    end if;
    v := null;
  end loop;
end $$;
revoke all on function public.rn_restore(timestamptz) from public, anon;
grant execute on function public.rn_restore(timestamptz) to authenticated;

/* ============ 2. Mantener el proyecto despierto ============
   Supabase gratis se pausa tras 1 semana sin uso. Un aviso automático semanal desde GitHub llama a esta función. */
create or replace function public.rn_ping() returns text language sql stable as $$ select 'ok'::text $$;
grant execute on function public.rn_ping() to anon, authenticated;

/* ============ 3. Registro por invitación ============
   Solo pueden crear cuenta los correos que agregues a rn_invites (Table Editor → rn_invites → Insert row).
   Ojo: también aplica a "Add user" del panel; agrega el correo aquí primero. */
create table if not exists public.rn_invites (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.rn_invites enable row level security;   -- sin reglas: nadie la lee desde la página, solo tú desde el panel
revoke all on public.rn_invites from anon, authenticated;

create or replace function public.rn_only_invited() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.rn_invites i where lower(i.email) = lower(new.email)) then
    raise exception 'RN_NO_INVITE';
  end if;
  return new;
end $$;
drop trigger if exists rn_only_invited on auth.users;
create trigger rn_only_invited before insert on auth.users for each row execute function public.rn_only_invited();

-- Tu correo (y los que ya tienen cuenta) no necesitan invitación porque ya existen. Ejemplo para invitar:
-- insert into public.rn_invites (email, note) values ('correo@ejemplo.com', 'Papá');

/* ============ 4. Lista de espera (página de bienvenida) ============
   Cualquiera puede apuntarse con su correo; solo tú ves la lista desde el panel. */
create table if not exists public.rn_waitlist (
  id         bigserial primary key,
  email      text not null,
  note       text,
  created_at timestamptz not null default now(),
  constraint rn_waitlist_email check (char_length(email) between 5 and 120 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint rn_waitlist_note check (note is null or char_length(note) <= 300)
);
create unique index if not exists rn_waitlist_email_unico on public.rn_waitlist (lower(email));
alter table public.rn_waitlist enable row level security;
drop policy if exists "rn_waitlist_apuntarse" on public.rn_waitlist;
create policy "rn_waitlist_apuntarse" on public.rn_waitlist for insert to anon, authenticated with check (true);
revoke all on public.rn_waitlist from anon, authenticated;
grant insert on public.rn_waitlist to anon, authenticated;
grant usage on sequence public.rn_waitlist_id_seq to anon, authenticated;
