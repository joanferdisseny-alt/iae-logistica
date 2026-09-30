# Auditoria previa a la presentacion - 30 de septiembre de 2026

## Dictamen

El codigo local supera las comprobaciones automatizadas indicadas abajo. El usuario ha reactivado Supabase y se ha confirmado una sesion real de administrador en produccion: las paginas revisadas de inventario, ubicaciones, cajas, solicitudes, checklists, recepcion, fichas, campos, sedes y usuarios cargan. Vercel sigue publicando el commit anterior `69a63d6`; faltan publicar las correcciones y preparar datos de demostracion. No se han probado escrituras remotas, aislamiento entre roles reales, camara fisica ni entrega de correo.

Esta es una revision acotada de codigo, pruebas, dependencias y arranque local de produccion. No sustituye una prueba de penetracion, una auditoria exhaustiva ni pruebas de aceptacion con usuarios reales. No se han modificado datos remotos, ejecutado migraciones en Supabase ni enviado correos.

## Hallazgos pendientes

### Resuelto - Fallo de conexion por proyecto Supabase pausado

El usuario confirma que el proyecto estaba pausado y lo ha reactivado. Se verifica posteriormente acceso autenticado y lectura del inventario en produccion. El diagnostico inicial se conserva a continuacion como historial, no como un bloqueo vigente.

El host configurado localmente, `deslcltuccutxuahwjew.supabase.co`, devuelve `ENOTFOUND`. En la misma comprobacion, `supabase.com` y `github.com` resuelven correctamente. Las 21 consultas de esquema de solo lectura no obtuvieron respuesta HTTP: esto NO demuestra que falten tablas y NO permite concluir que se hayan perdido datos.

Antes de reactivar Supabase, los seis intentos POST a `/auth/sign-in` del 30 de septiembre entre las 22:31 y las 22:33 CEST registraron `fetch failed`, con causa `getaddrinfo ENOTFOUND deslcltuccutxuahwjew.supabase.co`. Produccion no llegaba a comprobar las credenciales. El HTTP 200 de la accion de servidor no significa autenticacion correcta. Los registros por si solos no distinguian entre pausa, eliminacion o URL incorrecta; la causa se aclaro con la comprobacion del usuario.

El formulario devolvia el mismo mensaje de credenciales incorrectas para cualquier error del proveedor. Se ha corregido localmente `app/auth/actions.ts` para distinguir rechazo explicito de credenciales, limite de intentos, indisponibilidad de red/servidor y errores desconocidos, sin mostrar diagnosticos privados. Se han anadido seis pruebas de acceso y redirecciones. Este cambio de mensaje no repara la conectividad ni esta publicado todavia.

Antes de presentar, volver a comprobar que el proyecto sigue activo. No ha sido necesario crear otra base ni ejecutar `install.sql`. La lectura correcta de las paginas no verifica todas las funciones SQL ni sus permisos: sigue pendiente probar operaciones con cuentas de dos sedes y los tres roles.

### P1 - Cambios sin publicar por permisos de GitHub

La tabla compacta pendiente quedo guardada en el commit `84a8590`. El intento de `git push origin main` fallo con HTTP 403: GitHub identifica a `operacionescpbv-commits`, sin permiso de escritura sobre `joanferdisseny-alt/iae-logistica`.

Hay que autenticar Git con una cuenta autorizada o conceder acceso al repositorio. No se ha alterado la configuracion global de credenciales. Las correcciones de esta auditoria estan guardadas en el commit local `299d2eb`; no deben considerarse desplegadas hasta subirlas y comprobar el resultado de Vercel.

### P1 si se presentan avisos - Correo y programacion no verificados

En el entorno local faltan `CRON_SECRET`, `RESEND_API_KEY` y `ALERTS_FROM_EMAIL`. La revision posterior en Vercel confirma que las tres variables SI existen para Production y Preview, junto a las tres variables de Supabase. Se han consultado sus nombres y entornos, no revelado sus valores secretos ni comprobado su validez. No se ha enviado un mensaje de prueba. Las pruebas automatizadas de correo usan un proveedor simulado.

El cron se cierra por defecto si falta su secreto, y no genera ni envia avisos sin la configuracion del proveedor. `vercel.json` programa una ejecucion diaria a las 07:00 UTC; no es un aviso instantaneo. Verificar dominio remitente, destinatarios habilitados, responsables de logistica por sede, programacion y entrega real antes de anunciar esta funcion como operativa.

### Corregido localmente - Selector de relaciones truncado

En `app/dashboard/inventory/[itemId]/page.tsx`, el selector administrativo de otros articulos consultaba el catalogo sin paginacion. Ahora recorre paginas de 500, ordenadas por nombre e ID, manteniendo la sede del articulo y excluyendo el propio articulo. Si falla una pagina no muestra una lista parcial y presenta un aviso. Prueba con 501 candidatos y fallo de la segunda pagina. Para catalogos muy grandes sigue siendo aconsejable sustituir la descarga completa por un buscador remoto: es una mejora de rendimiento, no un limite silencioso actual.

### Configuracion pendiente para la demostracion

La lectura con administrador muestra cuatro sedes activas, un articulo sin ubicacion en Valencia y una caja vacia en Galicia. No se debe intentar meter ese articulo en la caja de otra sede para preparar la demo. No hay solicitudes ni checklists que permitan mostrar un recorrido real de retorno.

De cuatro plantillas, solo Herramientas electricas tiene campos asignados (seis). Las otras tres tienen cero. El catalogo muestra quince campos, sin uno especifico de caducidad. La cuenta revisada muestra Avisos sin configurar. Completar una plantilla, un lote y una caja de la misma sede con datos autorizados de prueba antes de presentar recepcion, caducidad o checklist; no se han creado durante esta auditoria.

### Seguridad operativa pendiente de confirmacion

Se compartieron credenciales privilegiadas en la conversacion. No se ha verificado su revocacion. Rotar las que sigan vigentes en su proyecto correspondiente y actualizar los entornos de forma coordinada. Nunca incluir secretos en variables `NEXT_PUBLIC_*` ni en Git. En los archivos actualmente versionados solo aparece `.env.example`, no `.env.local`; esta comprobacion no es un escaneo completo del historial de secretos.

## Correcciones realizadas

1. Panel por permisos: ocultados los accesos administrativos a Fichas, Usuarios y Sedes para no administradores. Incorporados accesos operativos a Checklists, Solicitudes y Recepcion. No se han ampliado permisos de escritura.
2. Catalogos completos en Fichas: lectura por paginas de 500, con orden estable, de plantillas, categorias y campos. Un error en una pagina posterior impide mostrar una lista parcial como si estuviera completa. Prueba con 501 registros en cada catalogo.
3. Caducidad al pasar los dias: el listado y la cabecera de la ficha calculan la alerta con la fecha actual de Madrid, aunque no haya movimientos que actualicen el estado SQL. El filtro Caducado se aplica en la base antes de paginar y contar; los otros estados excluyen esas existencias caducadas. La fecha de hoy no se considera ya caducada. No se han cambiado los estados persistidos ni las reglas del cron.
4. Actualizacion de pantalla tras guardar: crear, editar o borrar categorias invalida tambien su propia pagina; guardar preferencias de avisos invalida Usuarios. Pruebas de exito y rechazo de las mutaciones.
5. Dependencias: corregido un aviso de gravedad alta de `brace-expansion`, dependencia transitiva de desarrollo, actualizando 1.1.18 a 1.1.21 y 5.0.9 a 5.0.12. No se ha cambiado de version mayor de Next o React.
6. Acceso: mensajes distintos para errores de conexion, limite de intentos y rechazo de credenciales; redirecciones seguras conservadas y pruebas sin secretos en los mensajes.
7. Relaciones: catalogo completo de candidatos de la sede, sin truncado silencioso ni resultados parciales ante fallos.
8. Cantidades: los totales por marca y los resumenes de recepcion muestran `1` o `1,125`, en lugar de `1.000` o `1.125`. Se mantiene el calculo exacto con enteros en milesimas y el formato de los valores enviados a SQL. No se cambia ninguna existencia.
9. Portada: retirados los textos Base inicial y Ruta de construccion; roles Administrador, Editor y Lector descritos sin atribuir al editor permiso de modificar existencias.

La tabla compacta de inventario del trabajo anterior conserva filtros, paginacion de 50 filas, expansion de detalles, stock y estados visibles. La busqueda del listado se aplica en Supabase antes del limite de pagina, no solamente sobre los primeros articulos descargados.

## Verificacion

- Suite completa: 172 pruebas aprobadas. Incluye PostgreSQL local con PGlite para migraciones, RLS y operaciones atomicas; otras pruebas usan dobles de Auth, Supabase, camara o correo. No son 172 pruebas contra produccion.
- Cobertura ejercitada: perfiles activos y roles, aislamiento por sede, movimientos y recepciones idempotentes, reparto de existencias por lotes y destinos, solicitudes, checklists y QR, documentos, catalogos y filtros. Es evidencia de los casos probados, no garantia de ausencia de fallos.
- `npm run typecheck` y `npm run lint`: correctos.
- `npm audit --json`: cero vulnerabilidades conocidas reportadas tras la actualizacion. No equivale a una auditoria de seguridad de todo el producto.
- `npm run build`: correcto en una copia temporal aislada, con variables Supabase ficticias. No se ha utilizado ni borrado `.next` del servidor de desarrollo.
- Arranque local de la compilacion: portada y acceso responden 200; panel e inventario sin sesion redirigen con 307; un QR de existencias conserva su destino al ir al acceso; el cron sin secreto responde 503, sin ejecucion.
- `git diff --check`: correcto.
- Se ha verificado lectura con una sesion real de administrador y el menu a una anchura simulada de movil. No se han validado los otros roles en produccion, un recorrido movil de extremo a extremo, camara fisica, impresion QR ni entrega de correo. No se han medido tiempos de inicio de sesion reales.

## Comprobacion posterior en Chrome

- Proyecto: `joanfer/iae-logistica`. Dominio de produccion: https://iae-logistica.vercel.app/.
- Vercel muestra el despliegue actual como `Ready`, creado el 17 de septiembre desde `main`, commit `69a63d6`. No contiene los dos commits locales de esta auditoria y de la tabla de inventario.
- Tras la reactivacion y el inicio de sesion realizado por el usuario, se ha comprobado la lectura de las secciones privadas enumeradas en el dictamen, el detalle del articulo, su historial, las existencias y el detalle de la caja. No hay errores visibles de carga en esas pantallas.
- Tras refrescar los registros de Vercel, las consultas recientes revisadas responden 200. Permanecen los seis errores anteriores a la reactivacion, sin nuevos errores en el periodo revisado. Un HTTP 200 por si solo no valida permisos o escrituras.
- Las opciones Last 12 hours y Last day de los registros requieren Pro en esta cuenta. No se ha comprobado el cron de esta mañana ni cambiado el plan o la configuracion.
- La portada publicada conserva textos de prototipo; la correccion local descrita arriba esta pendiente de despliegue.
- El popup de QR de caja abre y muestra la URL correcta del dominio de produccion. No se ha usado la camara ni impreso una etiqueta.
- Prueba de inventario a 390 x 844: el menu abre y cierra; el documento mide 375 px de ancho frente a 390 px de viewport, sin desbordamiento horizontal observado. Se ha restaurado el viewport de escritorio. Esto no sustituye una prueba en un telefono real.
- No se han realizado redeploys, rotaciones de claves, cambios de variables ni operaciones sobre datos. No se han solicitado ni leido contraseñas.

## Guion de aceptacion antes de presentar

1. Subir los commits con la cuenta autorizada y confirmar que Vercel publica ese commit sin errores. Abrir su URL HTTPS definitiva, no un enlace antiguo.
2. Comprobar Supabase activo y migraciones aplicadas. Entrar como administrador, editor y lector en dos sedes distintas. Intentar abrir por URL un articulo de otra sede con un no administrador: debe quedar denegado.
3. Usar datos de demostracion identificados como tales: crear o consultar una ficha, localizar material, mostrar el reparto del mismo consumible en dos cajas y verificar que las cantidades suman el total.
4. Registrar una recepcion y comprobar sus cantidades e historial. Reintentar una confirmacion no debe duplicar stock. No usar existencias operativas reales para ensayar.
5. Crear un checklist de una caja de prueba, escanear el QR de una existencia de esa caja, introducir la cantidad devuelta y registrar un faltante. El QR de otra caja debe rechazarse. El checklist no corrige stock automaticamente.
6. Probar en el movil real el menu, las tablas y los popups, apertura y cierre de camara, documentos y cierre de sesion. Imprimir QR con el dominio definitivo; un QR de localhost o de otro dominio no sirve como etiqueta de produccion.
7. Si se muestran avisos, probar la entrega a un destinatario autorizado con configuracion de prueba y verificar que no se registra como enviado un correo rechazado.
8. Antes del uso operativo: copias y restauracion comprobadas, responsables de incidencias definidos y procedimiento alternativo sin conexion. La aplicacion no dispone de una operacion offline validada para emergencias.

No se recomienda introducir funcionalidades nuevas justo antes de la presentacion. Priorizar estos bloqueos y un recorrido real completo antes de ampliar catalogos, automatizaciones o integraciones externas.
