-- RN. · base de datos (pegar completo en Supabase → SQL Editor → Run)
-- Una fila por sección de datos de cada persona. Cada quien solo puede leer y escribir sus propias filas (RLS).
create table if not exists public.rn_docs (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc        text not null check (doc in ('meta','goals','habits','tasks','reviews')),
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, doc),
  constraint rn_docs_tamano check (pg_column_size(data) < 1000000)
);

alter table public.rn_docs enable row level security;

drop policy if exists "rn_leer_propio"      on public.rn_docs;
drop policy if exists "rn_crear_propio"     on public.rn_docs;
drop policy if exists "rn_actualizar_propio" on public.rn_docs;
drop policy if exists "rn_borrar_propio"    on public.rn_docs;

create policy "rn_leer_propio"       on public.rn_docs for select to authenticated using ((select auth.uid()) = user_id);
create policy "rn_crear_propio"      on public.rn_docs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "rn_actualizar_propio" on public.rn_docs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "rn_borrar_propio"     on public.rn_docs for delete to authenticated using ((select auth.uid()) = user_id);

-- Quien no ha iniciado sesión no puede tocar la tabla.
revoke all on public.rn_docs from anon;
grant select, insert, update, delete on public.rn_docs to authenticated;
