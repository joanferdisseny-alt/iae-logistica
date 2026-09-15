# Avisos de seguridad de Supabase

El informe recibido el 15 de septiembre contiene 30 avisos: 2 de search_path, 13 de permisos anonimos, 14 de permisos autenticados y 1 de proteccion de contraseñas filtradas. No es una prueba de que se haya producido una intrusion, pero identifica configuraciones que deben revisarse.

## Aplicar la correccion

En el proyecto existente con la actualizacion del 14 ya aplicada, ejecuta completo `supabase/fix-security-warnings-2026-09-15.sql` desde SQL Editor como postgres. No modifica ni borra inventario: fija configuracion de funciones y permisos. Es transaccional y registra su version para evitar repetirla. No se ha ejecutado remotamente desde Codex.

Si tambien faltan las actualizaciones funcionales, utiliza en su lugar el archivo completo actualizado `supabase/upgrade-2026-09-15.sql`, que ya incluye esta correccion. No uses `install.sql` en una base existente.

La correccion fija `search_path` en `set_updated_at` y `protect_field_key`, cuyas relaciones estan cualificadas. Revoca EXECUTE de PUBLIC y tambien de anon y authenticated en las funciones internas de triggers. En las ocho funciones necesarias para la aplicacion conserva solo el permiso autenticado, ademas de los privilegios del propietario/servicio.

La migracion anterior retiraba PUBLIC pero no todos los grants directos de anon: los permisos por defecto de Supabase pueden conceder ambos de forma independiente. La nueva prueba reproduce esos permisos explicitos, no solo los valores por defecto de PostgreSQL.

## Avisos que pueden permanecer

La actualizacion de existencias repartidas añade `manage_inventory_stock` con permiso autenticado intencionado: exige administrador y valida origen, lote, destino y cantidades. `sync_inventory_stock` y las funciones internas terminadas en `_before_distribution` no admiten ejecución por clientes anónimos ni autenticados. No se debe conceder acceso directo a estas funciones para silenciar un error de aplicación.

Estas ocho funciones SECURITY DEFINER conservan EXECUTE para authenticated de forma intencionada:

- `user_role`: resuelve el rol del usuario activo de la sesion, sin aceptar otro usuario como parametro.
- `user_headquarters_id`: resuelve la sede del usuario activo de la sesion.
- `can_manage_logistics_requests`: comprueba administrador o responsable activo de la sede.
- `create_inventory_record`: permite crear solo a administradores/editores y comprueba sede y destino.
- `place_inventory_item`: exige administrador y valida el destino.
- `record_inventory_movement`: exige administrador, valida cantidades y registra el saldo atomicamente.
- `update_inventory_item`: exige administrador y registra el cambio.
- `update_catalog_field`: exige administrador y actualiza el catalogo de manera atomica.

Al activar los checklists se anaden otras tres funciones SECURITY DEFINER con acceso autenticado intencionado y `search_path` fijo: `create_container_checklist`, `save_checklist_item` y `close_container_checklist`. Validan cuenta activa y sede; las dos ultimas exigen ser autor, administrador o responsable de logistica de la sede. Su acceso anonimo y las escrituras directas a sus tablas estan revocados. Estos tres avisos adicionales de acceso autenticado pueden permanecer por el mismo motivo.

No conviertas estas funciones a SECURITY INVOKER ni revoques sus permisos a ciegas: algunas evitan recursion en RLS y otras necesitan ejecutar una transaccion controlada que el usuario no puede escribir directamente. El aviso de acceso autenticado puede mantenerse aunque exista autorizacion dentro de la funcion. Debe revisarse de nuevo si cambia su cuerpo o la politica de altas. No se han silenciado avisos automaticamente.

Tras ejecutar la correccion, vuelve a analizar el proyecto con Security Advisor. Para las funciones de la aplicacion no deben quedar avisos de search_path mutable, acceso anonimo o acceso autenticado a triggers. Otras funciones ajenas al proyecto no se modifican.

## Contraseñas filtradas

La proteccion de contraseñas filtradas es una opcion de Supabase Auth, no una migracion SQL. En la configuracion de Auth activa Leaked Password Protection si tu plan lo permite. La documentacion oficial indica Pro o superior; en Free este aviso no se puede resolver solamente modificando el codigo. No se ha cambiado el plan ni la configuracion remota.

## Fuentes

- [Funciones de base de datos y permisos](https://supabase.com/docs/guides/database/functions).
- [Explicacion oficial del aviso 0029](https://github.com/supabase/splinter/blob/main/docs/0029_authenticated_security_definer_function_executable.md).
- [Seguridad de contraseñas y disponibilidad por plan](https://supabase.com/docs/guides/auth/password-security).
