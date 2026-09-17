# Busqueda online retirada

La busqueda de productos en internet se ha retirado de la aplicacion. No hay boton, consultas a catalogos externos ni autocompletado de fichas desde internet.

Se mantienen la camara y el lector de codigos, la busqueda en todo el inventario de la sede, la asociacion de variantes, el alta manual con fichas configuradas y las solicitudes de catalogacion. El reparto de existencias no cambia.

## Despliegue

Solo es necesario desplegar el codigo actualizado. No hace falta ejecutar SQL para retirar la funcion. Si se configuro `PRODUCT_LOOKUP_CONTACT` en Vercel o `.env.local`, se puede eliminar: ya no se utiliza.

## Compatibilidad

No se borran articulos ni historial. Las fuentes de altas anteriores siguen disponibles en su historial. Se mantiene el procesamiento de envios antiguos pendientes con el mismo identificador y contenido para evitar duplicados tras un fallo de red; ese procesamiento no consulta internet.

Las migraciones SQL existentes se conservan para no alterar el historial de instalaciones ya actualizadas. No deben revertirse ni ejecutarse scripts de borrado. La funcion SQL de procedencia antigua no realiza conexiones externas y no es utilizada por las altas manuales nuevas.
