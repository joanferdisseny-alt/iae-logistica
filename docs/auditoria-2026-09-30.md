# Auditoria previa a la presentacion - 30 de septiembre de 2026

## Dictamen

El codigo local supera las comprobaciones automatizadas indicadas abajo, tras corregir cinco problemas. No se puede certificar todavia el despliegue ni declarar lista la demostracion con datos reales: la subida a GitHub ha sido rechazada y el dominio Supabase configurado localmente no resuelve. No se ha facilitado una URL de Vercel para esta comprobacion.

Esta es una revision acotada de codigo, pruebas, dependencias y arranque local de produccion. No sustituye una prueba de penetracion, una auditoria exhaustiva ni pruebas de aceptacion con usuarios reales. No se han modificado datos remotos, ejecutado migraciones en Supabase ni enviado correos.

## Hallazgos pendientes

### P1 - Conexion al Supabase local no verificable

El host configurado localmente, `deslcltuccutxuahwjew.supabase.co`, devuelve `ENOTFOUND`. En la misma comprobacion, `supabase.com` y `github.com` resuelven correctamente. Las 21 consultas de esquema de solo lectura no obtuvieron respuesta HTTP: esto NO demuestra que falten tablas y NO permite concluir que se hayan perdido datos.

Antes de presentar, comprobar en el panel de Supabase el proyecto activo y su URL actual. Comparar las variables locales con las de Vercel. No crear otra base, borrar la existente ni ejecutar `install.sql` sobre datos existentes como supuesto remedio. Una vez accesible, verificar las migraciones de operaciones, solicitudes, checklists, stock distribuido y recepcion, con cuentas de dos sedes y los tres roles.

### P1 - Cambios sin publicar por permisos de GitHub

La tabla compacta pendiente quedo guardada en el commit `84a8590`. El intento de `git push origin main` fallo con HTTP 403: GitHub identifica a `operacionescpbv-commits`, sin permiso de escritura sobre `joanferdisseny-alt/iae-logistica`.

Hay que autenticar Git con una cuenta autorizada o conceder acceso al repositorio. No se ha alterado la configuracion global de credenciales. Los cambios de esta auditoria se guardaran tambien en Git local; no deben considerarse desplegados hasta subirlos y comprobar el resultado de Vercel.

### P1 si se presentan avisos - Correo y programacion no verificados

En el entorno local faltan `CRON_SECRET`, `RESEND_API_KEY` y `ALERTS_FROM_EMAIL`. No se han inspeccionado las variables de Vercel y no se ha enviado un mensaje de prueba. Las pruebas automatizadas de correo usan un proveedor simulado.

El cron se cierra por defecto si falta su secreto, y no genera ni envia avisos sin la configuracion del proveedor. `vercel.json` programa una ejecucion diaria a las 07:00 UTC; no es un aviso instantaneo. Verificar dominio remitente, destinatarios habilitados, responsables de logistica por sede, programacion y entrega real antes de anunciar esta funcion como operativa.

### P2 - Selector de relaciones pendiente de paginacion

En `app/dashboard/inventory/[itemId]/page.tsx`, el selector administrativo de otros articulos consulta el catalogo de su sede sin paginacion explicita. Con un catalogo que supere el limite de respuesta de Supabase, puede omitir candidatos. No afecta a la busqueda paginada del listado principal de inventario. Conviene sustituir este selector por una busqueda remota paginada, como la de solicitudes, antes de cargar catalogos grandes.

### Seguridad operativa pendiente de confirmacion

Se compartieron credenciales privilegiadas en la conversacion. No se ha verificado su revocacion. Rotar las que sigan vigentes en su proyecto correspondiente y actualizar los entornos de forma coordinada. Nunca incluir secretos en variables `NEXT_PUBLIC_*` ni en Git. En los archivos actualmente versionados solo aparece `.env.example`, no `.env.local`; esta comprobacion no es un escaneo completo del historial de secretos.

## Correcciones realizadas

1. Panel por permisos: ocultados los accesos administrativos a Fichas, Usuarios y Sedes para no administradores. Incorporados accesos operativos a Checklists, Solicitudes y Recepcion. No se han ampliado permisos de escritura.
2. Catalogos completos en Fichas: lectura por paginas de 500, con orden estable, de plantillas, categorias y campos. Un error en una pagina posterior impide mostrar una lista parcial como si estuviera completa. Prueba con 501 registros en cada catalogo.
3. Caducidad al pasar los dias: el listado y la cabecera de la ficha calculan la alerta con la fecha actual de Madrid, aunque no haya movimientos que actualicen el estado SQL. El filtro Caducado se aplica en la base antes de paginar y contar; los otros estados excluyen esas existencias caducadas. La fecha de hoy no se considera ya caducada. No se han cambiado los estados persistidos ni las reglas del cron.
4. Actualizacion de pantalla tras guardar: crear, editar o borrar categorias invalida tambien su propia pagina; guardar preferencias de avisos invalida Usuarios. Pruebas de exito y rechazo de las mutaciones.
5. Dependencias: corregido un aviso de gravedad alta de `brace-expansion`, dependencia transitiva de desarrollo, actualizando 1.1.18 a 1.1.21 y 5.0.9 a 5.0.12. No se ha cambiado de version mayor de Next o React.

La tabla compacta de inventario del trabajo anterior conserva filtros, paginacion de 50 filas, expansion de detalles, stock y estados visibles. La busqueda del listado se aplica en Supabase antes del limite de pagina, no solamente sobre los primeros articulos descargados.

## Verificacion

- Suite completa: 163 pruebas aprobadas. Incluye PostgreSQL local con PGlite para migraciones, RLS y operaciones atomicas; otras pruebas usan dobles de Auth, Supabase, camara o correo. No son 163 pruebas contra produccion.
- Cobertura ejercitada: perfiles activos y roles, aislamiento por sede, movimientos y recepciones idempotentes, reparto de existencias por lotes y destinos, solicitudes, checklists y QR, documentos, catalogos y filtros. Es evidencia de los casos probados, no garantia de ausencia de fallos.
- `npm run typecheck` y `npm run lint`: correctos.
- `npm audit --json`: cero vulnerabilidades conocidas reportadas tras la actualizacion. No equivale a una auditoria de seguridad de todo el producto.
- `npm run build`: correcto en una copia temporal aislada, con variables Supabase ficticias. No se ha utilizado ni borrado `.next` del servidor de desarrollo.
- Arranque local de la compilacion: portada y acceso responden 200; panel e inventario sin sesion redirigen con 307; un QR de existencias conserva su destino al ir al acceso; el cron sin secreto responde 503, sin ejecucion.
- `git diff --check`: correcto.
- Sin validacion visual de extremo a extremo en movil, sesion real, latencia real de Supabase, permisos de camara fisica, impresion QR ni entrega de correo. No se han medido tiempos de inicio de sesion reales.

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
