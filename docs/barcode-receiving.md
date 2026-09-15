# Recepcion por codigo de barras

## Activacion

1. Haz una copia de seguridad de la base de datos.
2. Ejecuta `supabase/upgrade-barcode-receiving.sql` completo en SQL Editor como postgres. Incluye las migraciones anteriores pendientes y usa el registro `iae_internal.migrations` para no repetirlas. No utilices `install.sql` sobre una base existente.
3. Despliega el codigo y las dependencias actualizadas. La camara necesita HTTPS en el movil; el HTTP de una IP local no basta. En el ordenador, localhost es valido.
4. Abre Recepcion desde el menu o Inventario. Prueba primero con un articulo de prueba y dos destinos de la misma sede.

No se ha ejecutado esta migracion en Supabase desde el entorno de desarrollo. No cambia las cantidades existentes ni atribuye una marca supuesta a existencias antiguas.

## Uso

- Selecciona sede y escanea, escribe el codigo o utiliza un lector USB que escriba como un teclado. Se conservan los ceros iniciales. La busqueda exacta consulta la base completa accesible en esa sede.
- Un codigo conocido muestra articulo, marca/modelo, unidades por envase, totales por marca y todas las posiciones con existencias. Un envase puede equivaler a varias unidades del articulo: 2 paquetes de 5 brocas son 10 unidades a repartir.
- Indica envases enteros, lote del fabricante, caducidad y motivo. Reparte las unidades entre cajas, ubicaciones directas o sin ubicacion. Cada linea tiene un solo tipo de destino; la caja conserva su ubicacion fisica. Confirma el resumen para sumar stock.
- Cada recepcion crea un lote independiente. Para distintos lotes o caducidades haz recepciones distintas. La fecha es obligatoria si el campo `expiration_date` esta configurado como obligatorio en la ficha.
- Un codigo desconocido se puede asociar expresamente a un articulo equivalente. Revisa diametro, compatibilidad, calidad y unidad de medida: el codigo no identifica automaticamente esas caracteristicas. La misma marca y modelo escritos exactamente igual reutilizan la variante; nuevos codigos pueden representar otros envases de esa variante.
- Si es otro articulo, utiliza Crear articulo nuevo y una ficha configurada. Esta alta empieza con cero existencias: despues se asocia el codigo y se confirma la recepcion. No introduces la compra dos veces.
- Si falta la ficha, administracion puede abrir Fichas en otra pestana y pulsar Actualizar catalogo al volver. Tambien se puede solicitar catalogacion con descripcion y numero de envases. Aparece en Solicitudes para administracion y los contactos de logistica de la sede, sin cambiar el stock. El circuito existente gestiona esa solicitud; no se envia un nuevo tipo de correo desde esta pantalla.
- Las etiquetas de lote incluyen marca/modelo, referencia abreviada y un identificador de recepcion. El historial conserva la referencia completa, codigo, conversion y reparto. Los checklists existentes siguen separando lotes y congelan sus etiquetas/cantidades.

## Permisos y garantias

- Administrador: asociar codigos, crear articulos y registrar entradas en cualquier sede activa.
- Editor: consultar y crear articulos de su sede. No modifica existencias de articulos existentes ni asocia codigos; puede enviar una solicitud a logistica despues del alta.
- Lector: consultar y solicitar catalogacion en su sede.
- Marcar a alguien como responsable de logistica no le concede permisos de escritura en el inventario.
- Las tablas de variantes, codigos y recibos son de solo lectura para clientes autenticados y tienen RLS a traves del articulo. Las escrituras pasan por funciones SQL con comprobaciones de permisos y sede.
- La recepcion completa es una transaccion: si falla la ultima caja, se deshacen todas las entradas, el lote y el historial. La cantidad asignada debe coincidir exactamente con envases por unidades y usa hasta tres decimales.
- Un identificador de recepcion solo puede repetirse con el mismo autor y contenido. Se reutiliza si falla la respuesta. Con almacenamiento de sesion disponible, la pestaña conserva la operacion pendiente para recuperarla al recargar y volver a consultar el codigo. No es un modo sin conexion; no registres otra recepcion mientras haya una pendiente sin confirmar. Cerrar la pestana, borrar su almacenamiento o cambiar de dispositivo puede perder ese borrador: comprueba el historial antes de repetir.
- No se permite dividir ni multiplicar una herramienta identificada por numero de serie.

## Limites deliberados

- Se mantiene el modelo actual de articulo por sede. Un codigo se registra una sola vez por sede; no crea articulos compartidos ni traslados entre sedes.
- No hay consulta a catalogos comerciales externos ni equivalencias automaticas entre codigos UPC/EAN/GTIN con distinta representacion. Se compara el texto leido; los alias se asocian explicitamente al mismo articulo y variante.
- Marcas antiguas desconocidas y lotes manuales sin variante se muestran como Marca no registrada. No se reasignan retroactivamente. Para nuevo stock por marca utiliza Recepcion.
- No se reasignan codigos ya asociados ni se editan conversiones con historial desde esta version. Una asociacion equivocada necesita revision administrativa antes de usarla, no una sobrescritura silenciosa.
- Camara implementada con `@zxing/browser`, cargado solo al pulsar Leer con la camara. Se liberan las pistas al cerrar, detectar, cambiar de pagina u ocultar la pestaña. Validar fisicamente en los moviles de la ONG antes de uso operativo.

## Verificacion local

`npm test`, `npm run typecheck`, `npm run lint` y compilacion aislada sin tocar `.next` del servidor de desarrollo. Las pruebas PostgreSQL locales comprueban RLS, privilegios, marcas, envases, reparto, rollback, reintentos, altas sin stock, solicitudes y herramientas con serie.

Referencia de la libreria: https://github.com/zxing-js/browser
