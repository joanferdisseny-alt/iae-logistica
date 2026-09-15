# Instalación

Para actualizar una base existente, usa [la guía de actualización](actualizacion-2026-09-14.md), no este instalador.

1. Crea el proyecto Supabase y conserva la contraseña de base de datos en un gestor de contraseñas.
2. Configura `.env.local` con las variables de `.env.example`. La URL y la clave pública pertenecen al mismo proyecto. La clave secreta es exclusivamente del servidor: nunca debe llevar el prefijo `NEXT_PUBLIC_` ni subirse al repositorio.
3. En una base vacía, ejecuta `supabase/install.sql` completo desde SQL Editor como `postgres`. Incluye esquema, permisos, funciones y bucket privado `inventory-documents`. No ejecutes después las migraciones históricas individualmente.
4. Crea el primer usuario en Authentication. Su perfil se genera automáticamente. Desde SQL Editor, asigna a ese perfil el `role_id` de `app_roles.code = 'admin'` y comprueba `is_active = true`. Verifica cuidadosamente el usuario seleccionado antes de cambiarlo.
5. Mantén desactivada el alta pública. Los administradores crean el resto de usuarios desde la aplicación. Editores y lectores necesitan una sede; el administrador puede acceder globalmente.
6. Ejecuta `npm install` y `npm run dev`. Para producción, configura las mismas variables en Vercel y utiliza la URL pública del despliegue en los ajustes de autenticación de Supabase.

## Correo

Configura `CRON_SECRET`, `RESEND_API_KEY` y `ALERTS_FROM_EMAIL` en Vercel. El remitente debe estar autorizado por Resend. `vercel.json` solicita ejecutar `/api/cron/expiry-alerts` diariamente a las 07:00 UTC.

En Usuarios, configura explícitamente el correo, el plazo y la suscripción de cada destinatario. Los administradores reciben avisos globales; los responsables de logística no administradores reciben los de su sede. Marcar responsable no activa por sí solo el envío de correo.

Comprueba la ejecución del cron en el despliegue y realiza una prueba controlada con un destinatario autorizado antes de depender de los avisos. Las pruebas locales usan un proveedor simulado, no acreditan entrega real.
