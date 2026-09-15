# Checklists de retorno de cajas

## Activacion

En el SQL Editor del proyecto Supabase de esta aplicacion, ejecuta completo `supabase/upgrade-checklists-2026-09-15.sql` como postgres. Incluye las migraciones previas y omite las que ya esten registradas. No uses `install.sql` sobre una base existente. La migracion no se ejecuta automaticamente al desplegar la web.

El cambio crea `container_checklists`, `container_checklist_items` y tres funciones transaccionales. No modifica las existencias ni envia correos. Reinicia el servidor local si fuera necesario despues de aplicar el SQL.

## Uso

1. Desde una caja, pulsa **Nuevo checklist**, o entra en **Checklists** y selecciona una caja de tu sede.
2. Indica practica/entrenamiento o intervencion real, nombre, fecha y equipo opcional. Crea el registro antes de salir: se guarda una copia del contenido y de las cantidades actuales.
3. Al volver, revisa cada articulo. **Todo en su sitio** confirma toda la cantidad esperada. Para faltas, consumo, material danado o fuera de sitio, indica la cantidad devuelta y una nota.
4. Confirma si la propia caja ha regresado a la ubicacion de referencia. Si no, explica donde queda en el resumen.
5. Finaliza cuando no quede ningun articulo pendiente. El sistema calcula si la revision esta completa o tiene incidencias. El historial conserva nombres, cantidades, resultados y quien realizo cada comprobacion y el cierre.

Solo se permite una revision abierta por caja. Una revision creada por error puede cancelarse indicando un motivo; se conserva como cancelada, sin certificar el retorno. Los registros cerrados no se pueden editar ni eliminar desde la aplicacion.

## Permisos

- Administradores: acceso y supervision de todas las sedes.
- Cualquier miembro activo, incluidos lectores: puede crear y completar sus propias revisiones de cajas de su sede, sin modificar el inventario.
- Responsables de logistica: pueden completar y cerrar revisiones de otros miembros de su sede, independientemente de su rol.
- El resto de miembros de la sede puede consultar esas revisiones, pero no cambiarlas. No hay acceso entre sedes para usuarios no administradores.

Esta facultad operativa es independiente del permiso para editar existencias. La base de datos aplica los permisos: no depende de ocultar botones. No se conceden escrituras directas a las tablas ni ejecucion anonima de funciones. Las comprobaciones concurrentes detectan revisiones obsoletas; hay que recargar antes de guardar de nuevo.

## Alcance y precauciones

Con la actualizacion de [existencias repartidas](distributed-stock.md), las nuevas revisiones desglosan cada articulo por lote y solo incluyen su cantidad en la caja elegida. Los registros anteriores conservan su referencia original, sin atribuirles un lote retroactivamente.

- La referencia es el contenido al crear el checklist. Si se crea despues del entrenamiento, no reconstruye el contenido anterior aunque se indique una fecha pasada. Los cambios posteriores de inventario no modifican esa referencia.
- Registrar consumo, deterioro o faltas no descuenta stock ni cambia el estado operativo: un administrador debe regularizar el inventario mediante sus movimientos habituales. Asi se evitan descuentos duplicados.
- Hay un checklist por caja. Para varias cajas de una misma actividad, utiliza el mismo nombre, fecha y equipo; no existe todavia un expediente conjunto de intervencion.
- El checklist no avisa automaticamente por correo ni funciona sin conexion. Comprueba que cada resultado figure guardado antes de cerrar o salir de la pagina.
- Las referencias historicas impiden borrar fisicamente cajas, articulos o usuarios vinculados; desactivalos cuando dejen de utilizarse.
- Una comprobacion es una declaracion del equipo, no una deteccion automatica mediante QR ni una garantia del estado real del material.

## Verificacion

`tests/checklists.database.test.cjs` ejecuta PostgreSQL local con PGlite para comprobar aislamiento por sede, permisos, contenido congelado, cantidades, concurrencia, cierres, cancelaciones e inmutabilidad. `tests/checklists.test.cjs` cubre validacion y acciones de servidor. Estas pruebas no acceden a Supabase ni modifican datos de produccion.
