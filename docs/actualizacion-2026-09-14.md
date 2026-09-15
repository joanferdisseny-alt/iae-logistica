# Actualización de logística IAE

## Activación en el proyecto existente

1. Conserva una copia de seguridad de la base actual y, si es posible, prueba primero en una copia de ensayo.
2. Abre `supabase/upgrade-2026-09-15.sql` y ejecuta su contenido completo en SQL Editor del proyecto correcto, con rol `postgres`. Incluye la actualización del día 14 y el buscador de artículos en solicitudes del día 15; omite las versiones ya registradas. No uses `install.sql` sobre los datos actuales.
3. La actualización es una transacción: si falla, no aplica parcialmente estos cambios. Guarda el error exacto; no borres tablas para continuar. Incluye un registro de versiones para que repetir este archivo no vuelva a ejecutar migraciones ya aplicadas.
4. El archivo presupone el esquema de esta aplicación anterior a la auditoría. No reinstala ni elimina datos. Las inconsistencias antiguas entre sedes, cajas o ubicaciones deben revisarse, no se corrigen moviendo materiales silenciosamente. Los artículos con estado antiguo de mantenimiento pasan a inspección.
5. Reinicia el servidor local con las dependencias actualizadas: detén `npm run dev` con Ctrl+C, ejecuta `npm install` y después `npm run dev`. Despliega también el código nuevo en Vercel si usas producción.
6. Verifica el acceso con un administrador, un editor y un lector de sedes distintas. No desactives RLS para resolver errores de acceso.

## Uso y permisos

- Administrador: configuración global, usuarios, sedes, ubicaciones, cajas, movimientos de stock, estados, documentos y avisos.
- Editor: crea artículos de su sede y consulta los datos de su sede. No modifica existencias o artículos ya creados.
- Lector: consulta su sede.
- Responsable de logística: etiqueta independiente del rol. Permite gestionar solicitudes de su sede sin convertirse en administrador. Los usuarios normales pueden crear solicitudes y consultar las propias.
- Los administradores no necesitan sede asignada. Los demás usuarios sí, y los perfiles desactivados pierden acceso.

## Operaciones

- La ficha del artículo permite registrar entradas, salidas y ajustes con motivo e historial. Un ajuste indica la cantidad final contada. Se admiten tres decimales y no se permite stock negativo.
- El estado operativo es independiente de la caducidad o el stock: disponible, en uso, reparación, inspección o retirado.
- Cada registro o lote tiene una sola ubicación: directa o dentro de una caja. Si está en una caja, hereda su ubicación. Toda la cantidad del registro se ubica junta; para repartir existencias entre cajas o caducidades se necesitan registros separados. No hay reparto automático de lotes.
- Desde la ficha se adjuntan PDF, JPEG o PNG privados de hasta 4 MB, o enlaces HTTPS. La descarga comprueba el acceso al artículo y utiliza un enlace temporal.
- Las solicitudes tienen seguimiento e historial dentro de la aplicación. Esta versión no envía correos de solicitudes.
- Las listas principales tienen filtros y paginación. La vista de caja muestra el contenido a todo el ancho; las asignaciones se gestionan desde el artículo.

## Activar los avisos por correo

Configura en el servidor `CRON_SECRET`, `RESEND_API_KEY` y `ALERTS_FROM_EMAIL`, sin pegarlos en conversaciones ni subirlos al repositorio. Las claves secretas compartidas anteriormente deben revocarse y sustituirse.

El cron de `vercel.json` está programado a las 07:00 UTC diariamente. En Usuarios, un administrador debe configurar la suscripción, dirección y antelación del destinatario. Un responsable no administrador sólo recibe datos de su sede; un administrador suscrito recibe datos globales.

Se procesan caducidad, stock mínimo y mantenimiento. La aceptación por el proveedor no garantiza entrega final. Los errores quedan reflejados en la respuesta del cron; revisa su ejecución en Vercel. Los avisos resueltos no se reabren automáticamente. El envío masivo es secuencial y necesita vigilancia de duración antes de ampliar el uso.

## Verificación y límites

Se han añadido pruebas locales de autenticación, SQL/RLS, integridad, movimientos, solicitudes y correo simulado, además de comprobaciones de tipos, lint y compilación de producción aislada del servidor de desarrollo.

No se ha ejecutado esta migración contra tu Supabase, ni se ha probado la entrega real de emails, el almacenamiento remoto o un recorrido completo en un móvil físico. Esas verificaciones siguen siendo necesarias después de activar la actualización. No se garantiza que toda la aplicación esté libre de errores.

Siguientes ampliaciones funcionales: transferencia formal entre sedes, reserva y devolución de material por intervención, inventario esperado de cada caja y copias de seguridad verificadas. No están incluidas en esta actualización.
