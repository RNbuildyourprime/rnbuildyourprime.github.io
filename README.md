# RN. · Right Now

*Build your prime. Right now.*

App personal de objetivos, hábitos, XP y un coach (Wolf). Versión web: `index.html` + Supabase para el inicio de sesión y los datos.

- `index.html` — la app completa (generada; no editar a mano).
- `shim.js` — inicio de sesión y conexión con la base de datos.
- `config.js` — dirección y clave **pública** de Supabase (la seguridad la dan las reglas de `supabase.sql`).
- `supabase.sql` — tabla y reglas de acceso (cada persona solo ve sus datos).
- `vendor/supabase.js` — cliente oficial de Supabase (sin depender de otros sitios).

Los datos de cada persona **nunca** se guardan en este repositorio.
