# Comprobacion diaria de Supabase

`/api/cron/database-check` consulta como maximo un codigo de `app_roles` una vez al dia. No modifica datos, no envia correos y no devuelve filas ni credenciales. No necesita una migracion SQL. Es independiente de `/api/cron/expiry-alerts`, por lo que funciona aunque no este configurado Resend.

`vercel.json` programa la comprobacion a las 06:00 UTC; los avisos siguen a las 07:00 UTC. En Hobby la ejecucion puede ocurrir en cualquier momento de esa hora. Los cron de Vercel se activan en despliegues de produccion, no en local ni en Preview.

## Activacion y comprobacion

1. Configurar en Vercel, para Production, `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. Reutilizar el secreto existente de los avisos. No publicarlo ni ponerlo en una URL. No hacen falta variables de correo para esta comprobacion.
2. Desplegar esta version en produccion. En Settings > Cron Jobs debe aparecer `/api/cron/database-check` habilitado. Revisar tambien que las tareas cron esten habilitadas para el proyecto.
3. Ejecutar exclusivamente la tarea `database-check` con Run y consultar sus Logs. No ejecutar `expiry-alerts` como prueba de conexion: puede enviar correos reales.
4. Confirmar un HTTP 200 con `ok: true`. El resultado incluye la hora de comprobacion y duracion, pero no el contenido de la consulta.
5. Revisar el registro de la siguiente ejecucion programada; una prueba manual no demuestra que se haya ejecutado el horario diario.

Vercel envia `Authorization: Bearer <CRON_SECRET>` automaticamente. Abrir la URL en un navegador sin ese encabezado debe devolver 401 y no consulta Supabase. No se permite autenticar mediante parametros de URL ni cookies. Las respuestas no se almacenan en cache.

## Fallos y limites

- HTTP 401: credencial de la llamada incorrecta o ausente.
- HTTP 503: falta `CRON_SECRET`, falla la configuracion de Supabase, la base no responde o la consulta falla. Tiene un limite de espera de 8 segundos y no reintenta indefinidamente. El motivo generico queda en los registros, sin datos de conexion.
- La base ya pausada se debe reanudar desde Supabase; esta tarea no la reactiva ni crea proyectos.
- Los fallos quedan visibles en los registros de Vercel. No se ha configurado un sistema adicional de notificaciones de disponibilidad.
- Generar actividad diaria puede reducir las pausas del plan Free, pero no garantiza evitarlas ni asegura disponibilidad durante emergencias. El plan Pro elimina las pausas por inactividad.

Referencias: [Supabase: pausas](https://supabase.com/docs/guides/platform/free-project-pausing), [Vercel: gestion de cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [limites y horarios](https://vercel.com/docs/cron-jobs/usage-and-pricing).
