# Existencias repartidas por lote y destino

## Activacion en una base existente

1. Haz una copia de seguridad antes de actualizar la base de datos.
2. En el proyecto Supabase conectado a esta aplicacion, abre SQL Editor y ejecuta completo `supabase/upgrade-distributed-stock.sql` como postgres.
3. Recarga la aplicacion. No ejecutes `install.sql` en una base con datos.

El archivo incluye las migraciones anteriores y omite las registradas. La actualizacion es transaccional: si falla, no deja una migracion parcial. No se ha ejecutado en Supabase desde este desarrollo.

Las existencias actuales se convierten en un lote por articulo, conservando codigo, caducidad, cantidad, caja o ubicacion directa y notas de la asignacion. Si no habia codigo de lote, se usa `Inicial`. No se suman unidades nuevas. Los checklists anteriores conservan sus cantidades e historial.

La migracion se detiene si encuentra cajas con cantidades incompatibles con el stock antiguo, asignaciones dobles o herramientas con numero de serie y stock distinto de cero o uno. Revisa esos registros: no se corrigen inventando cantidades.

## Uso

La ficha de inventario incorpora **Existencias y ubicaciones**, visible para todos los usuarios autorizados de la sede. Administracion dispone de **Gestionar existencias**:

- **Trasladar entre destinos:** elige una existencia de origen (lote + caja/ubicacion), destino y cantidad. Resta del origen y suma al destino manteniendo el lote y el total.
- **Entrada en lote existente:** suma unidades al lote y destino seleccionados.
- **Consumo / salida:** descuenta unidades solo de la existencia elegida.
- **Recuento de una existencia:** establece la cantidad fisicamente contada en ese lote y destino, no el total del articulo. Permite cero.
- **Nuevo lote / recepcion:** crea un codigo de lote con su caducidad opcional y cantidad inicial en el destino elegido.
- **Editar lote y caducidad:** modifica los datos del lote sin cambiar sus cantidades.

El alta del articulo sigue creando sus existencias iniciales en un destino; despues se pueden repartir sin duplicar la ficha. Los destinos pueden ser varias cajas, varias ubicaciones directas o una combinacion de ambas. Cada cantidad tiene un unico destino: una caja hereda su ubicacion fisica, no recibe otra ubicacion directa adicional.

Ejemplo: una ficha con 30 brocas puede tener 8 en la caja de intervencion, 4 en la de practicas y 18 en un armario. Trasladar 3 del armario a la caja deja 11, 4 y 15; el total sigue siendo 30.

## Integridad y permisos

Los cambios se ejecutan mediante una funcion transaccional, con bloqueo de concurrencia, control de saldo por origen, hasta tres decimales e identificador de reintento. La interfaz conserva los datos cuando una respuesta no se puede confirmar. Las operaciones sobre una existencia comprueban si su cantidad ha cambiado desde que se cargo el formulario.

Un lector/editor no puede modificar existencias existentes. Se mantiene la facultad del editor de crear articulos en su sede. Los administradores gestionan las existencias. No se admiten destinos de otras sedes. Las herramientas con numero de serie no pueden dividirse ni acumular mas de una unidad.

`inventory_stock_lots` e `inventory_stock_positions` son las fuentes del reparto. `inventory_items.current_stock`, su ubicacion unica cuando proceda, su proxima caducidad y `inventory_container_items` son proyecciones para las pantallas existentes. Se han retirado las escrituras directas de los clientes a esas cantidades. No uses scripts que modifiquen solo `current_stock` ni edites manualmente la tabla antigua de cajas.

Las posiciones a cero se conservan para permitir nuevas entradas y mantener referencias. Cajas, ubicaciones y articulos referenciados no se borran fisicamente: pueden desactivarse. El historial registra origen, cantidad, destino, motivo, actor y saldo; los traslados no aparecen como compras o consumos.

## Cajas, checklists y avisos

Las cajas muestran los articulos desglosados por lote. Los nuevos checklists guardan una linea por articulo y lote presentes en esa caja al crear la revision. No incluyen las unidades en otras cajas ni cambian al mover o consumir material despues. Revisar un checklist sigue sin ajustar automaticamente el inventario.

Los correos de caducidad tienen en cuenta los lotes con saldo positivo y la antelacion del destinatario. Agrupan por articulo y fecha de caducidad, incluyendo los lotes, cantidades y destinos afectados. Se mantiene la deduplicacion por destinatario, articulo, tipo y fecha; no se reenvia un aviso de la misma fecha por cada traslado. El aviso de stock bajo compara el total del articulo en su sede con su minimo, no un minimo por caja.

## Alcance de esta entrega

Este cambio resuelve el reparto dentro de cada sede. Se conserva el modelo actual de articulo perteneciente a una sede; no se ha migrado a una ficha global compartida entre varias sedes ni se han implementado transferencias intersede. Los administradores siguen viendo los articulos de todas las sedes. Esa unificacion del catalogo requiere otra migracion de permisos, referencias y totales, no agrupar automaticamente articulos que coincidan en nombre.

No hay reservas por intervencion, minimos por caja ni sincronizacion sin conexion. La caducidad pertenece al lote; el estado operativo y los datos tecnicos siguen perteneciendo al articulo.

## Pruebas

Las pruebas de PostgreSQL local comprueban migracion de datos, reparto entre dos cajas y armario, salidas y recuentos, reintentos, concurrencia, lotes/caducidades, checklists congelados, permisos y herramientas con serie. Las pruebas de acciones y notificaciones usan dobles locales: no modifican Supabase ni envian correos reales.
