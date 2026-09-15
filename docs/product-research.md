# Borradores online de productos

## Activacion

1. En Supabase SQL Editor, ejecuta `supabase/upgrade-product-research.sql` sobre la base existente. Es transaccional, conserva los datos y omite migraciones ya registradas. No uses `install.sql` sobre una base con datos.
2. Despliega el codigo actualizado en Vercel. La consulta general usa UPCitemdb EXPLORER, sin clave ni suscripcion de pago.
3. Para habilitar tambien alimentos, configura `PRODUCT_LOOKUP_CONTACT` en Vercel (y `.env.local` en desarrollo) con un correo tecnico de la ONG. Open Food Facts lo recibe en el User-Agent, no es un token. Revisa sus condiciones y completa su formulario de uso de API enlazado en la documentacion oficial. Vuelve a desplegar al cambiar variables.

No se aplican migraciones remotas ni se publican cambios automaticamente desde este desarrollo.

## Flujo

- Recepcion busca primero el codigo exacto en el catalogo de la sede. Si existe, mantiene el flujo normal de existencias y reparto.
- Para un codigo desconocido, pulsa **Buscar producto en internet**, elige **Productos generales** o **Alimentos** y pulsa **Consultar codigo**. No hay consultas al escribir ni al abrir la pantalla.
- Se exige un EAN/UPC/GTIN de 8, 12, 13 o 14 digitos con digito de control valido. Los codigos internos y QR siguen siendo locales. No se expanden automaticamente codigos UPC-E.
- Solo se presentan productos con identificador coincidente; un resultado ambiguo no genera borrador. Se conserva el significado del nivel de embalaje GTIN: nunca se transforma un codigo de caja en el de una unidad.
- Elige una ficha existente y revisa la correspondencia entre datos externos y campos configurados. Los nombres conocidos tienen sugerencias; para campos personalizados puedes seleccionar un dato compatible o dejarlos manuales. No se crean categorias ni campos automaticamente.
- Confirma la revision, pasa al formulario y completa/corrige sus datos antes de guardar. Cambiar de ficha limpia los campos del formulario y no importa el borrador de otra ficha.
- La creacion y la anotacion de fuente en el historial son una unica operacion. Reintentar la misma alta no duplica ni el articulo ni el historial. El articulo empieza sin stock; asociar el codigo/variante y recibir las cantidades siguen siendo pasos explicitos de administracion.
- Administradores y editores pueden preparar altas segun sus permisos. Lectores pueden consultar resultados y solicitar catalogacion, pero no crear. Si falta una ficha adecuada, administracion la configura o se solicita a logistica.

## Datos que no se importan

Stock, cantidades, unidades por envase, caducidad, lote, serie, ubicacion, estado operativo, mantenimiento, alertas y referencias internas permanecen manuales. El peso o la presentacion del fabricante no se convierten automaticamente en unidades de inventario. No se interpreta compatibilidad entre herramientas ni se agrupan marcas por similitud.

Fotos, PDF y manuales no se descargan. Se ofrece un enlace para buscar el fabricante/manual en otra pestana; la carga o asociacion de documentos sigue el flujo y permisos existentes. No se usan IA ni consultas web generativas para inventar especificaciones.

## Proveedores, condiciones y limites

- [UPCitemdb](https://www.upcitemdb.com/wp/docs/main/development/getting-started/): catalogo general, modalidad EXPLORER sin API key. La documentacion indica 100 consultas diarias y limites de rafaga; revisar cuotas y [condiciones](https://devs.upcitemdb.com/termsofservice) antes de ampliar su uso. No garantiza disponibilidad ni exactitud.
- [Open Food Facts](https://openfoodfacts.github.io/openfoodfacts-server/api/): API v3 de alimentos, con identificacion de la aplicacion, limites por IP y datos comunitarios. La base tiene licencia ODbL y sus contenidos DbCL; se muestra atribucion y enlace a la fuente. Antes de distribuir o exportar datos derivados, revisar sus [condiciones de reutilizacion](https://world.openfoodfacts.org/terms-of-use). No se importan imagenes. Ingredientes/alergenos deben comprobarse en el envase, no usarse como verificacion sanitaria.

Protecciones locales: 8 segundos de timeout; respuestas de hasta 256 KiB; hosts fijos y sin redirecciones; ninguna URL devuelta por terceros se descarga; hasta 6 consultas por usuario/minuto, 5 consultas generales/minuto y 90/dia, y 10 consultas de alimentos/minuto. Cache de exitos durante 6 horas (hasta 250 entradas), ausencias durante 5 minutos y deduplicacion de consultas simultaneas. Los errores no se cachean como ausencias.

La cache y los limites son **por instancia de servidor**, no una cuota distribuida garantizada. Vercel puede ejecutar varias instancias y compartir IP con otros procesos; se respetan respuestas 429 con enfriamiento, sin reintentos automaticos. Para un volumen elevado se necesitara un limitador/cache compartido y revisar las condiciones de los proveedores. La falta de cobertura o de cuota nunca impide el alta manual.

De la ONG solo se consulta el codigo, ademas del correo tecnico configurado para Open Food Facts y los metadatos normales de una conexion HTTPS. No se envian usuarios autenticados, sedes, cantidades ni claves de Supabase. La fuente en el historial es una declaracion de revision del usuario, no una certificacion independiente del producto.

## Comprobaciones

`npm test`, `npm run typecheck`, `npm run lint`. Los tests usan respuestas simuladas y PostgreSQL local PGlite: no crean articulos reales ni envian correo. Para probar visualmente, utiliza un codigo desconocido en la sede y verifica el borrador antes de confirmar un alta real.
