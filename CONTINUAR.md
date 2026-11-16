# RN. · Guía para continuar

Estado al 15 nov 2026 (noche). Este archivo explica qué hay, cómo funciona y qué falta, para seguir sin contexto previo (otro chat, plan gratis u otra persona).

## 0. Dónde vive todo (actualizado 15 nov, noche)

- **Página:** https://rnbuildyourprime.github.io (landing) · https://rnbuildyourprime.github.io/app.html (app)
- **Código:** organización de GitHub **RNbuildyourprime**, repo **rnbuildyourprime.github.io**. El link viejo `leotiburciogo-alt.github.io/RN` ya no existe.
- **Supabase:** Site URL y Redirect URL ya apuntan al link nuevo. `supabase_v3.sql` ya corrido, función `rn-push` desplegada (JWT apagado) y Leo ya es admin.
- **Google Search Console:** propiedad verificada con la cuenta de Google de RN. (etiqueta en `index.html`) y `sitemap.xml` enviado.
- **Pendiente opcional:** correo propio por SMTP (Gmail de RN. + contraseña de aplicación) y plantillas de correo con la marca. Los pasos están en la guía "RN. Activación".

## 1. Qué es cada archivo

| Archivo | Qué hace |
|---|---|
| `index.html` | Página de bienvenida (landing). Si hay sesión, manda a `app.html`. **Es la fuente:** se edita directo (las fuentes originales se perdieron). |
| `app.html` | La app completa (HTML + CSS + JS en un archivo). **Es la fuente.** |
| `shim.js` | Conexión con Supabase: inicio de sesión, crear cuenta, guardar en la nube, historial. |
| `config.js` | URL de Supabase + clave **publishable** (es pública, va bien aquí). |
| `sw.js` | Service worker: permite instalar la app y abrirla sin internet. Al cambiar `app.html`, sube la versión `rn-v2` → `rn-v3` para que los teléfonos tomen lo nuevo más rápido. |
| `manifest.webmanifest` + `icon-*.png` + `apple-touch-icon.png` | Lo que hace que se instale como app. |
| `supabase.sql` | Tablas base (ya corrido). |
| `supabase_v3.sql` | Recordatorios (tabla `rn_push`, aviso cada hora) y estadísticas de la landing (`rn_visits`, `rn_stats`). **Correr una vez.** |
| `supabase/functions/rn-push/index.ts` | Función que manda los recordatorios. Se pega en Supabase → Edge Functions. |
| `sitemap.xml` | Lista de páginas para Google. |
| `supabase_v2.sql` | Historial, invitaciones, lista de espera y ping. **Correr una vez** (ver §3). Se puede repetir sin problema. |
| `.github/workflows/keepalive.yml` | Avisa a Supabase lunes y jueves para que el proyecto gratis no se pause. |

Nunca subir al repo: claves `secret` / `service_role`, contraseña de la base de datos, ni datos de usuarios.

## 2. Funciones nuevas (nov 2026)

**App instalable y sin internet**
- iPhone: abrir el link en Safari → Compartir → "Agregar a pantalla de inicio".
- Android: Chrome → menú ⋮ → "Instalar app".
- Computadora: Chrome/Edge → icono de instalar en la barra de dirección.
- Sin internet: la app abre con lo último guardado; lo que hagas se guarda en el teléfono y se sube solo al volver la conexión ("Subí los cambios que hiciste sin conexión").

**Sincronización segura**
- Si editas en dos lugares, se combinan por elemento (no se pisa todo).
- La app recuerda la última versión sincronizada (`sos-base`) y si hay cambios pendientes (`sos-pend`).

**Historial de versiones** (requiere `supabase_v2.sql`)
- Ajustes → Datos y respaldo → Historial de versiones → "Volver aquí".
- Se guarda una copia como máximo cada 10 min por sección, durante 30 días.
- Antes de restaurar se guarda cómo estaba, así que se puede deshacer.

**Registro por invitación + lista de espera**
- Crear cuenta: `app.html#crear` o el botón "Crear mi cuenta" del modal de la landing.
- Solo funciona si el correo está en `rn_invites`.
- Quien no tiene invitación se apunta a la lista de espera en la landing (`#acceso`). La lista se ve en Supabase → Table Editor → `rn_waitlist`.

**Resumen del mes**
- Historias a pantalla completa: XP, constancia (calendario), hábito estrella, logros, área más fuerte, cierre con Wolf.
- Del día 1 al 7 aparece una tarjeta en Inicio con el mes anterior; desaparece al verla.
- Siempre disponible en Evolución → "Resumen de…" (con selector de mes).
- "Compartir imagen" crea una imagen vertical 1080×1920 (historia de Instagram).


## 2b. Funciones nuevas (15 nov, noche)

- **Registro rápido:** tarjetas por hábito. Un toque registra, otro toque quita. Los hábitos con cantidad muestran botones (10/15/30/45/60 min o tus valores recientes). Los objetivos dicen qué registran ("+ Sesión", "+ Avance").
- **Atajos:** Ajustes → Atajos de un toque. Cada hábito tiene un link `app.html#log=ID` que lo registra. También existen `#quick` (registro rápido), `#cierre` (cierre de semana) y `#resumen` (resumen del mes).
- **Cierre de semana guiado:** tarjeta en Inicio de viernes a lunes, y botón en Reflexiones. Tiene 4 pasos: semana, bien, ajustar y plan.
  - "Bajar la meta" usa `h.adj` durante 4 semanas.
  - Las prioridades se vuelven tareas de prioridad alta de la semana siguiente.
- **Respaldo:** Ajustes → Datos y respaldo → "Descargar respaldo" (en el celular abre Compartir para guardarlo en Archivos) y "Restaurar desde archivo".
- **Recordatorios:** Ajustes → Recordatorios.
  - Se pueden apagar todos o uno por uno, cada uno a la hora que elijas, y no llegan en pausa.
  - Necesitan `supabase_v3.sql` y la función `rn-push`.
- **Estadísticas de la landing:** sin cookies. Aparecen en Ajustes solo para administradores (tabla `rn_admins`).
- **Landing:** formulario de lista de espera también al final de la página.
- **Contraseñas:** el navegador o el Llavero las guardan y sugieren tu correo.

## 3. Lo que tienes que hacer tú en Supabase (una sola vez)

1. **SQL Editor → New query** → pegar todo `supabase_v2.sql` → **Run**. Debe decir "Success".
2. **Authentication → Sign In / Providers → Email**:
   - "Allow new users to sign up": **ON** (el disparador de invitaciones bloquea a quien no esté invitado).
   - "Confirm email": **OFF**, para entrar directo. Si lo dejas ON, el usuario debe confirmar desde su correo y el correo gratis de Supabase tiene límite por hora.
3. **Invitar a alguien:** Table Editor → `rn_invites` → Insert row → `email`, y opcionalmente `note` (ej. "Papá"). Mándale `https://rnbuildyourprime.github.io/app.html#crear`.
   - Ojo: "Add user" del panel también pasa por la invitación; agrega el correo a `rn_invites` primero.
4. **Ping:** GitHub → repo → Actions → "keepalive" → Run workflow. Debe salir verde. Si sale rojo, normalmente es porque el paso 1 no se ha corrido.

## 4. Cómo probar cambios sin romper nada

- Probar en local: en la carpeta del repo, `python3 -m http.server 8765` → abrir `http://localhost:8765/app.html`.
- Modo demo: en la consola del navegador, `startDemo()` llena la app con datos de ejemplo. Sales desde Ajustes.
- Después de editar `app.html`: subir la versión en `sw.js`, hacer commit y push. GitHub Pages tarda 1 o 2 minutos.
- Si un cambio rompe la app: GitHub → History del archivo → revertir el commit. Tus datos están en Supabase, no en el código.

## 5. Ideas pendientes (por prioridad)

**RN. dentro de la app**
1. Recordatorios con notificación: hábito del día o revisión del domingo. Requiere web push; en iPhone solo funciona con la app instalada.
2. Revisión semanal guiada de 3 minutos los domingos, conectada al resumen.
3. Exportar o importar todo en un archivo `.json` desde Ajustes, como respaldo personal fuera de Supabase.
4. Widgets o atajos: registrar un hábito desde un link (`app.html#log=ID`) para un acceso directo de iPhone.
5. Rendimiento: `app.html` pesa ~860 KB. Separar el CSS y JS en archivos permite que el navegador los guarde en caché.

**Landing (lo de más margen)**
1. Peso: `index.html` pesa ~600 KB (≈214 KB de CSS y 115 KB de JS en línea). Quitar el CSS que no se usa y diferir las animaciones de abajo haría que cargue más rápido en celular.
2. Prueba social real: cuando haya usuarios, 2 o 3 citas reales con permiso. Mientras tanto, mostrar el número de la lista de espera.
3. Un solo llamado a la acción claro por sección ("Apartar mi lugar"), y repetir el formulario de lista de espera al final, no solo en el modal.
4. SEO: agregar `robots.txt`, `sitemap.xml` y datos estructurados (`SoftwareApplication`). Skills útiles: `seo-audit` y `ai-seo`.
5. Analítica sin cookies (Plausible, GoatCounter o Umami) para saber de dónde llega la gente y cuántos se apuntan.
6. Un video corto de 20 a 30 s de la app real en el hero o en Cómo funciona. Skill útil: `video-making`.
7. Revisar textos con la skill `humanizer`, y el diseño fino con `make-interfaces-feel-better` y `frontend-design`.

**Datos / Supabase / GitHub**
1. Respaldo automático semanal: un workflow de GitHub que exporte a un lugar privado. No al repo, porque es público.
2. Correo propio (SMTP con Resend o similar) si activas "Confirm email" o "Olvidé mi contraseña" con muchos usuarios.
3. Dominio propio (ej. `rnprime.app`) apuntando a GitHub Pages.
4. Panel de Supabase → Advisors → revisar avisos de seguridad y rendimiento de vez en cuando.
