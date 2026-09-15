# Contratos de solicitudes

- Navegacion: `/dashboard/requests` (todos los usuarios activos); detalle `/dashboard/requests/[requestId]`.
- Dependencia: ejecutar `supabase/upgrade-2026-09-15.sql` en el proyecto existente. Incluye las migraciones previas con control de versiones y la nueva referencia de articulos. No se ejecutan migraciones remotas automaticamente.
- Usuarios: el check administrativo debe guardar `profiles.is_logistics_contact` sin cambiar `role_id` ni interpretar nombres/etiquetas de rol. El modulo consulta el booleano aparte de `requireAccess()`.
- Un usuario activo de cualquier rol crea solicitudes en su sede activa. Admin puede elegir cualquier sede activa. No se admite crear en nombre de otra persona.
- Lectura: solicitudes propias en la sede actual; responsables de logistica ven y gestionan todas las de su sede; admin global. Las solicitudes antiguas de una sede desactivada siguen siendo consultables/gestionables segun esos permisos.
- Estados: `pending -> accepted -> preparing -> completed`; desde cada estado no final se permite `cancelled`. Solo responsables/admin avanzan estados. El autor puede cancelar su propia solicitud pendiente. No hay reapertura, edicion del contenido ni borrado fisico; la baja funcional es cancelar conservando historial.
- Tabla `logistics_requests`: `id`, `headquarters_id`, `created_by`, `material` (2-160), `quantity` (positivo, hasta 999999999.999, 3 decimales), `unit` (1-40), `notes` (hasta 2000), `status`, `created_at`, `updated_at`. Un material libre por solicitud; no necesita existir en inventario y no cambia stock.
- Tabla `logistics_request_history`: `id`, `request_id`, `actor_id`, `from_status` (null en alta), `to_status`, `created_at`. Escritura atomica solo por trigger; clientes solo leen lo que permite la RLS de la solicitud.
- Acciones locales: `createRequest(previous, FormData)` usa `headquartersId`, `material`, `quantity`, `unit`, `notes`; fuerza sede del perfil para no-admin. `changeRequestStatus(previous, FormData)` usa `requestId`, `expectedStatus`, `status`; devuelve error si la fila ha cambiado o faltan permisos.
- Badge: contar `logistics_requests` con `status = 'pending'` usando el cliente autenticado (RLS aplicada). El listado ya lo incluye. No hay bandeja de correo, envios, cron, secretos de servicio ni acoplamiento con avisos de articulos.
- SQL auxiliar: `can_manage_logistics_requests(uuid)` consulta usuario activo, codigo `admin` o booleano + sede; no se basa en etiquetas.

## Referencia de articulos

El popup incluye busqueda por nombre, con un minimo de dos caracteres y 300 ms de espera. Devuelve hasta 20 articulos de la sede seleccionada, incluido stock cero; si hay mas resultados pide afinar el texto. Para no administradores se usa siempre la sede del perfil, no el parametro del navegador. Cambiar sede limpia la seleccion.

`logistics_requests.item_id` es opcional. Al seleccionar articulo se completa nombre y unidad, y la lista/detalle enlazan a su ficha. Las etiquetas se guardan como instantanea y no cambian al renombrar el articulo. Las solicitudes antiguas y el material libre conservan referencia nula. No hay reserva ni descuento de stock; la cantidad solicitada puede superar las existencias.

La accion y un trigger de base de datos validan sede y existencia, y toman nombre/unidad del articulo. La referencia no es editable y bloquea el borrado fisico del articulo para conservar trazabilidad. La ficha enlazada sigue protegida por RLS si el articulo se traslada posteriormente. Las pruebas incluyen peticiones manipuladas y actualizacion con solicitudes previas.
