# Devoluciones mediante QR

## Etiquetas

- El QR general de un articulo abre su ficha. El de una caja abre su contenido.
- El nuevo QR de existencias identifica una posicion de stock: articulo, lote y caja o ubicacion. Un mismo articulo en dos cajas tiene dos etiquetas distintas. No duplica la ficha del catalogo.
- Se obtiene con el boton QR de cada existencia en la ficha del articulo o junto a cada lote en el contenido de una caja.
- Imprime desde el dominio definitivo de produccion, no desde localhost ni desde una preview. El lector integrado solo acepta enlaces del mismo origen. Si cambia el dominio, hay que reimprimir las etiquetas o implementar una migracion de enlaces.
- La etiqueta de existencias corresponde al destino, no a una unidad fisica serializada. Si se traslada el material a otra caja, usa la etiqueta de la posicion de destino. No cambies ni borres una etiqueta para ocultar faltantes.
- Las posiciones con cantidad cero conservan su referencia; un QR antiguo nunca supone que sigue habiendo material. Las referencias eliminadas o no accesibles no se resuelven.

## Uso

1. Crea el checklist antes de salir: conserva como referencia los lotes y cantidades que tenia la caja.
2. Al regresar, abre esa revision y pulsa **Leer con la camara** en **Escanear devoluciones**.
3. Escanea el QR de existencias. La camara se detiene al leerlo. Tambien puedes introducir el enlace mediante un lector externo o manualmente.
4. Introduce la cantidad realmente devuelta y el estado. No se presupone la cantidad esperada. Una diferencia requiere una incidencia y una nota.
5. Confirma y pulsa **Escanear siguiente**. La lectura por si sola nunca escribe ni incrementa cantidades.
6. Comprueba las lineas pendientes y cierra la revision con el flujo habitual.

El QR puede ponerse en una bolsa o compartimento, pero leer la etiqueta NO demuestra que esten todas las piezas. Es una comprobacion asistida, no deteccion RFID.

## Protecciones y limites

- Solo pueden guardar quienes ya pueden completar el checklist: autor, administrador o responsable de logistica autorizado. Se mantienen las restricciones de sede y las politicas RLS.
- Una etiqueta de otra caja, otro lote, otra sede o un lote que no estaba en la referencia inicial no marca ninguna linea.
- Las lineas ya comprobadas no se cuentan de nuevo ni se sobrescriben desde el escaner. Las correcciones se hacen en la linea manual existente.
- El servidor vuelve a resolver la etiqueta al guardar. El RPC existente comprueba permisos, cierre y revision bajo bloqueo para evitar sobrescrituras concurrentes.
- Si la respuesta de guardado se pierde, vuelve a escanear. Si se habia guardado, aparecera como ya comprobado.
- Los checklists antiguos sin referencia de lote se completan manualmente; no se deduce un lote que no se guardo.
- No se cambia el stock, la ubicacion ni el cierre de la caja al escanear. Faltantes, consumos y movimientos requieren las operaciones de inventario autorizadas.
- No funciona sin conexion. La camara requiere permiso y HTTPS (localhost solo sirve para pruebas en ese dispositivo). Se detiene al ocultar la pagina, desmontar el componente o leer un codigo.
- Abrir un QR desde la camara del telefono muestra existencias y enlaces a caja/checklists, sin registrar una devolucion. Si falta la sesion, se conserva el destino tras iniciar sesion.

## Despliegue

No hay migracion nueva. Requiere las migraciones ya existentes de checklists, existencias distribuidas y recepcion por codigo de barras. No se han realizado cambios en Supabase desde esta implementacion.

Validacion de campo pendiente: imprimir dos etiquetas del mismo articulo en cajas distintas, probar con un movil real, contar un faltante, repetir una lectura y verificar que solo cambia la revision correcta, nunca el stock.
