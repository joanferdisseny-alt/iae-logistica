# Auditoria de Logistica IAE - 14 de septiembre de 2026

> Informe del estado previo a las correcciones. El codigo y las referencias de linea descritos a continuacion corresponden a la auditoria inicial. Se ha implementado una primera actualizacion de seguridad, integridad y operacion; consultar [activacion y limites](actualizacion-2026-09-14.md). La base de datos remota y el despliegue siguen pendientes de verificacion. Este informe se conserva como historial, no como una descripcion del estado actual del codigo.

## Dictamen y alcance

La aplicacion tiene una base de catalogo configurable, sedes, usuarios, relaciones, ubicaciones y cajas. Todavia no debe considerarse un ERP operativo validado: hay defectos de autorizacion e integridad y faltan los flujos de consumo, reposicion y mantenimiento.

Revision del codigo local de App Router, acciones de servidor, clientes Supabase, esquema y migraciones SQL, formularios, CSS, configuracion y documentacion. No se ha accedido a datos reales de Supabase, comprobado las politicas desplegadas, enviado correos ni modificado el comportamiento de la aplicacion. Los hallazgos SQL describen los archivos locales; la base desplegada puede diferir. No se ha realizado una prueba visual en dispositivos ni una prueba de penetracion del despliegue.

P1 = corregir antes del uso operativo; P2 = corregir para asegurar fiabilidad y usabilidad. Las carencias funcionales se distinguen de los defectos del codigo existente.

## Hallazgos prioritarios

### A01 - P1 - Escrituras de ubicacion sin aislamiento por sede

Referencias: `app/dashboard/actions.ts:985`, `app/dashboard/actions.ts:1030`, `app/dashboard/actions.ts:572`.

`addItemToContainer` y `assignItemPlacement` comprueban que el actor sea editor/administrador, pero despues usan `createAdminClient()` con los identificadores enviados por el formulario. No comprueban la sede ni la visibilidad del articulo o destino. Un editor que conozca identificadores de otra sede puede modificar sus asignaciones. Crear un articulo en caja utiliza tambien el cliente administrativo sin validar la sede de la caja. Los UUID y las opciones visibles del formulario no sustituyen esta comprobacion.

Correccion: verificar usuario activo, articulo y destino en el servidor, exigir coincidencia de sedes y ejecutar la operacion con RLS y una funcion transaccional. Las politicas de composicion de cajas y relaciones tambien deben comprobar ambos extremos, no solo la caja o el articulo origen.

Evidencia: reproduccion local del codigo con un editor simulado; la accion llega a una escritura administrativa por ID sin ninguna lectura de pertenencia del articulo/destino.

### A02 - P1 - Lectura global para usuarios sin sede y confianza en una sesion no verificada

Referencias: `app/dashboard/inventory/page.tsx:86`, `app/dashboard/inventory/page.tsx:133`, `app/dashboard/locations/page.tsx:93`, `app/dashboard/locations/page.tsx:125`, `app/dashboard/layout.tsx:30`.

El filtro solo se aplica cuando el usuario no es administrador Y tiene sede. Un lector sin sede consulta con el cliente administrativo todas las sedes, ubicaciones y cajas, y los ultimos 50 articulos globales. Un error al consultar el perfil produce tambien una sede nula. El trigger de alta crea perfiles sin sede, por lo que no es un caso imposible.

Ademas, las paginas confian en `getSession().user`. En ubicaciones, ese ID se usa para recuperar el rol con privilegios administrativos, sin validar primero la identidad. Una cookie no verificada no debe autorizar acceso privilegiado. Supabase advierte expresamente de esta limitacion de [getSession](https://supabase.com/docs/reference/javascript/auth-getsession).

Correccion: verificar identidad, rechazar perfiles inexistentes/inactivos y bloquear por defecto el acceso de no administradores sin sede. Preferir consultas sujetas a RLS.

Evidencia: pagina de inventario ejecutada con un lector simulado sin sede; las cuatro consultas administrativas salen sin filtros de sede. No se ha probado una suplantacion HTTP contra un servidor real.

### A03 - P1 - Desactivar usuarios no revoca sus permisos

Referencias: `app/dashboard/actions.ts:206`, `app/dashboard/actions.ts:229`, `app/dashboard/actions.ts:402`, `supabase/schema.sql:314`.

La interfaz modifica `profiles.is_active`, pero los controles de acceso y las funciones SQL de rol/sede no lo consultan. Tampoco se bloquea la cuenta de Auth. Un editor o administrador desactivado puede seguir accediendo y ejecutando acciones mientras tenga una sesion valida.

Correccion: exigir perfil activo en cada autorizacion y en RLS; definir bloqueo de Auth y tratamiento de sesiones existentes. Proteger tambien al ultimo administrador: actualmente se impide desactivarse a uno mismo, pero no degradar su propio rol y dejar el sistema sin administradores.

Evidencia: un perfil simulado con `is_active: false` supera `requireInventoryManager` y ejecuta una escritura.

### A04 - P1 - Reubicar puede perder la asignacion anterior o crear dos ubicaciones

Referencias: `app/dashboard/actions.ts:1037`, `app/dashboard/actions.ts:1062`, `app/dashboard/actions.ts:1081`, `app/dashboard/actions.ts:987`, `supabase/schema.sql:207`.

Al cambiar de caja se elimina la asignacion antigua y se vacia la ubicacion antes de insertar el nuevo destino. Si la insercion falla, el articulo queda sin su ubicacion anterior. Las escrituras paralelas tampoco forman una transaccion. El indice unico impide dos cajas, pero no impide caja mas ubicacion directa. El formulario del detalle de caja sigue llamando a `addItemToContainer`, que no limpia la ubicacion directa.

Correccion: una unica operacion transaccional con bloqueo del articulo, validacion previa del destino y garantia de exclusividad en base de datos. Unificar todos los puntos de entrada.

Evidencia: al simular un fallo al insertar la nueva caja, la accion devuelve error y ya ha eliminado ambas asignaciones previas.

### A05 - P1 - Correos marcados como enviados cuando no se ha enviado ninguno

Referencias: `app/api/cron/expiry-alerts/route.ts:57`, `app/api/cron/expiry-alerts/route.ts:199`.

Sin proveedor/remitente configurados, `sendEmail` devuelve `skipped: true`; el llamante ignora ese resultado, incrementa `sentEmails` y escribe `notification_events`. Cuando se configure el correo, esos articulos se excluyen como ya notificados para esa fecha.

En el entorno local revisado estan ausentes `RESEND_API_KEY` y `ALERTS_FROM_EMAIL`. No se han verificado las variables de Vercel.

Correccion: no registrar envios omitidos, diferenciar pendiente/aceptado por proveedor/fallido, comprobar errores al guardar eventos y usar idempotencia para ejecuciones concurrentes. La aceptacion por el proveedor tampoco equivale a entrega final al destinatario.

Evidencia: ejecucion simulada sin proveedor; cero llamadas de correo, `sentEmails: 1` y una insercion de evento.

### A06 - P1 - El proceso de avisos queda abierto si falta el secreto

Referencia: `app/api/cron/expiry-alerts/route.ts:32`.

`isAuthorized` devuelve verdadero cuando falta `CRON_SECRET`. En local esta variable esta ausente. Si un despliegue comparte esa configuracion, cualquiera puede activar el proceso que escribe alertas y, cuando exista proveedor, envia correos.

Correccion: fallar de forma cerrada si falta configuracion; autenticar siempre la llamada y evitar carreras entre ejecuciones. No hay `vercel.json` que documente el horario; puede existir un programador externo, pendiente de comprobar.

Evidencia: peticion simulada sin cabeceras y sin secreto recibio 200 y ejecuto el procesamiento.

### A07 - P1 - Politicas de perfiles con dependencia recursiva

Referencias: `supabase/schema.sql:314`, `supabase/schema.sql:374`, `supabase/migrations/20260706_headquarters.sql:99`.

La politica de lectura de `profiles` llama a `user_role()`, que a su vez consulta `profiles` con los permisos del llamante. Se crea una dependencia recursiva en la comprobacion de permisos que puede hacer fallar consultas de perfiles y otras tablas que dependen de ellas. `user_headquarters_id()` depende tambien de perfiles.

Correccion: resolver el rol y la sede mediante funciones acotadas que no reentren en esa politica, con contexto de ejecucion, `search_path` y permisos explicitos. Probar con las credenciales reales de los tres roles; el cliente administrativo omite RLS y no valida estas politicas.

Evidencia: analisis SQL local. No se ha ejecutado contra PostgreSQL ni confirmado que la instancia desplegada conserve estas definiciones.

### A08 - P1 - Version del framework pendiente de parches de seguridad

Referencias: `package-lock.json`, `next.config.ts:7`.

Version instalada: Next.js 15.5.12; React 19.2.4; Supabase SSR 0.5.2; Supabase JS 2.98.0. El [boletin oficial del 25 de agosto de 2026](https://nextjs.org/blog/august-2026-security-release) publica 15.5.24 como version corregida de esa rama. Se debe actualizar el framework y revisar el arbol de dependencias con sus avisos antes del despliegue. No se afirma que todos los CVE sean explotables en esta aplicacion: algunos requieren Windows o procesamiento de imagenes especifico. La configuracion permite imagenes desde cualquier subdominio de Supabase; conviene limitarla al proyecto usado.

No se ha realizado un analisis completo de vulnerabilidades de todas las dependencias ni actualizado paquetes durante esta auditoria.

## Otros defectos de fiabilidad

### A09 - P2 - Inventario limitado a 50 sin paginacion y errores mostrados como vacio

Referencias: `app/dashboard/inventory/page.tsx:117`, `app/dashboard/inventory/page.tsx:175`, `app/dashboard/locations/page.tsx:131`.

Los articulos antiguos desaparecen del listado al superar 50 y los contadores describen solo esa muestra. No hay busqueda, filtros ni navegacion para recuperar el resto. Varias consultas ignoran `error` y muestran listas vacias, dificultando distinguir falta de datos, permisos y caidas del servicio.

Corregir con paginacion y recuentos de servidor, filtros por sede/categoria/estado/ubicacion y estados de error explicitos con reintento. El listado y los correos consultan solo `locations(name)`: un articulo en caja figura sin ubicacion aunque la caja si la tenga. Mostrar su ubicacion efectiva y la ruta completa de estanteria/estante.

### A10 - P2 - Los campos configurables no se validan en servidor

Referencias: `app/dashboard/actions.ts:449`, `app/dashboard/actions.ts:472`, `app/dashboard/actions.ts:554`, `app/dashboard/inventory/create-item-form.tsx:183`.

El alta lee la plantilla, pero no sus campos: acepta cualquier `templateField_*` sin comprobar obligatoriedad, tipo u opciones. La validacion HTML es eludible. Los enteros negativos se convierten a cero y los decimales se truncan. `is_consumable` depende de los codigos fijos `food/consumable` y de una categoria recibida del formulario, aunque el administrador puede crear categorias nuevas.

Validar la ficha completa en servidor y definir el comportamiento consumible/caducable como propiedades explicitas independientes del nombre o codigo de categoria. Las cantidades deben admitir la precision necesaria para kg, litros o metros.

### A11 - P2 - Sedes y cantidades inconsistentes en cajas y ubicaciones

Referencias: `app/dashboard/actions.ts:686`, `app/dashboard/actions.ts:735`, `app/dashboard/actions.ts:899`, `supabase/schema.sql:152`.

Se puede asignar una ubicacion padre de otra sede o cambiar la sede de una caja sin trasladar/comprobar su contenido. Solo se rechaza un padre igual a si mismo, no ciclos A -> B -> A. Las cantidades de caja no se comparan con el stock del articulo. El selector de ubicaciones del administrador no se filtra al cambiar de sede.

Aplicar integridad de sede y jerarquia en base de datos y servidor. Tratar cambios de sede como traslados explicitos. Definir si una fila representa una unidad fisica o existencias agrupadas antes de validar cantidades.

### A12 - P2 - Ediciones y borrados silenciosos; cambios de campos sin migrar datos

Referencias: `app/dashboard/actions.ts:1146`, `app/dashboard/actions.ts:1182`, `app/dashboard/actions.ts:1501`, `app/dashboard/actions.ts:1639`.

Varias acciones ignoran errores y retornan sin feedback. El borrado de sedes cuenta usuarios/articulos pero no ubicaciones/cajas, cuyas claves foraneas pueden impedirlo silenciosamente. Renombrar la clave de un campo modifica catalogo y asignaciones en dos escrituras separadas, pero no las claves guardadas en `technical_specs` de los articulos existentes. Cambiar un campo especial de caducidad puede dejar de alimentar la fecha operativa.

Devolver resultados explicitos, proteger los codigos internos en uso y versionar o migrar los cambios de estructura de forma transaccional. No eliminar informacion historica al retirar un campo.

### A13 - P2 - Renovacion de sesion incompleta y redireccion de acceso sin validar

Referencias: `middleware.ts:3`, `lib/supabase/server.ts:32`, `app/auth/actions.ts:14`, `app/auth/actions.ts:32`.

El middleware es neutro y solo coincide con login, mientras el cliente servidor descarta errores al escribir cookies y delega esa renovacion en el middleware. Una renovacion durante un Server Component puede no persistirse en el navegador, contribuyendo a sesiones inconsistentes. No se ha reproducido el fallo con una sesion real expirada ni se atribuyen a esto todas las demoras anteriores.

`signIn` redirige directamente al parametro `next` recibido del formulario; debe limitarse a rutas internas permitidas. Restaurar un ciclo de sesion verificada con persistencia de cookies y medir tiempos de autenticacion/consultas.

### A14 - P2 - Instalacion y controles de calidad no reproducibles

Referencias: `supabase/migrations/20260228_dynamic_categories.sql:19`, `docs/setup.md`, `package.json:9`, `app/dashboard/inventory/create-item-form.tsx:37`.

La migracion de categorias lee una columna `category` que ya no existe en el esquema actual. Seguir el esquema completo y despues esa migracion falla. La guia mezcla instalacion nueva con actualizacion historica. Varias migraciones comparten prefijo de fecha, sin una secuencia de versiones unicas preparada para una ejecucion automatica fiable.

`npm run lint` no analiza el proyecto: abre el asistente por falta de configuracion. No hay pruebas automatizadas propias detectadas. El formulario de alta coloca `useEffect/useMemo` despues de un retorno condicional; si las plantillas pasan de vacias a no vacias en la misma instancia, cambia el orden de hooks. Un lint funcional debe detectarlo.

Definir una instalacion nueva verificable y migraciones incrementales, configurar lint y pruebas de permisos/integridad. La carpeta revisada no es un repositorio Git; no se puede verificar historial, rama o remoto desde ella.

## Cobertura funcional frente al uso de la ONG

| Necesidad | Estado observado | Siguiente paso |
| --- | --- | --- |
| Sedes y tres roles | Existen; aislamiento incompleto | Corregir A01-A03 y probar cada rol con dos sedes |
| Categorias, plantillas y campos | CRUD disponible | Validacion, claves estables y cambios compatibles |
| Herramientas en servicio/reparacion/baja | Un campo `status` mezcla stock y disponibilidad | Estados operativos separados e historial de mantenimiento |
| Consumos y reposiciones | Tabla `inventory_movements`, sin flujo de acciones/UI que la utilice | Entradas, salidas, ajustes y saldo atomico con autor/motivo |
| Editar articulos existentes | Se puede ubicar y asociar; no hay edicion general de la ficha | Editar atributos y registrar cambios; baja/archivo conservando historial |
| Herramientas y fungibles compatibles | Se pueden crear relaciones entre articulos | Compatibilidad a nivel de modelo y existencias por sede; quitar/editar relaciones |
| Caducidad | Una fecha por articulo y cron parcial | Lotes, avisos fiables, cobertura de vencidos y estado de envio |
| Cajas de intervencion/practicas | Tipo y contenido disponibles | Inventario esperado frente a real, incidencias y estado preparada/incompleta |
| Fotos, PDF y manuales | Columna de fotos; no hay flujo de adjuntos | Storage privado, permisos por sede y enlaces validados |
| Solicitudes a logistica | No hay modulo ni etiqueta de responsable | Responsables por sede independientes del rol y peticiones con seguimiento |
| QR | Disponible para articulos y cajas | Dominio publico estable; un QR de localhost no sirve fuera de ese equipo |

El estado `ok/low/expired/maintenance` no debe representar a la vez stock, caducidad y operatividad. Actualmente se calcula `ok/low` al crear y no hay un flujo que mantenga los demas estados al pasar el tiempo o consumir material. El cron solo considera fechas desde hoy: lo ya caducado antes de una ejecucion queda fuera. La creacion de alertas depende de que existan preferencias de correo habilitadas, y no se implementan avisos de stock bajo o mantenimiento.

## Modelo propuesto

Conservar las categorias y plantillas como catalogo comun de la ONG, administrado centralmente. Separar el modelo de material de sus unidades o lotes reales por sede.

- Modelo: por ejemplo, taladro de un modelo concreto, compatible con brocas SDS-plus. Aqui van manuales, caracteristicas y fotografia de referencia.
- Unidad de equipo: taladro con numero de serie, sede, estado operativo, QR e historial propios.
- Lote de consumible: pienso o brocas con cantidad, unidad de medida, sede y caducidad cuando corresponda. Distintos lotes pueden tener fechas diferentes.
- Ubicacion: jerarquia sede > almacen > estanteria > estante. Cada unidad o partida localizada tiene destino directo o caja; la caja aporta la ubicacion efectiva.
- Movimiento: entrada, consumo, ajuste, traslado, entrega o devolucion, con cantidad, autor, fecha y motivo. Mantener saldo y registro en la misma transaccion.
- Caja: contenido esperado y real para intervencion o practicas, revision y faltantes. Un modelo consumible puede repartirse entre cajas mediante partidas localizadas; una unidad fisica no puede estar en dos sitios.
- Mantenimiento: fuera de servicio, en reparacion, pendiente de revision, disponible o baja, con fechas, responsable y adjuntos.

Ejemplo: el catalogo contiene un modelo de broca; Valencia dispone de 30 unidades, con 10 en caja A, 10 en caja B y 10 en armario. Son existencias del mismo modelo en tres partidas, no tres catalogos incompatibles. El indice actual de una caja por articulo exige separar estos conceptos para no perder la trazabilidad de cantidades.

Para ropa, incorporar talla y entregas/devoluciones a voluntarios. Para solicitudes, usar una marca de responsable de logistica por sede independiente de administrador/editor/lector. La capacidad de recibir una solicitud no debe elevar los permisos del usuario.

## Diseno y operacion movil

Observaciones del codigo, pendientes de validacion visual en dispositivos:

- La tabla movil tiene un minimo de 720 px (`app/globals.css:1204`): requiere desplazamiento horizontal. Proponer filas compactas o tarjetas resumidas con nombre, estado, cantidad y ubicacion; detalles al abrir.
- Priorizar busqueda, filtro de sede y acceso por QR; ofrecer filtros de disponible, en reparacion, stock bajo, proximo a caducar y sin ubicar.
- Mostrar la ruta completa de ubicacion y un enlace al contenido de la caja; el listado actual solo muestra el nombre de la ubicacion directa.
- Unificar los popups con gestion de foco, retorno al disparador, cierre por Escape y nombre accesible. Los modales revisados no implementan ese ciclo completo.
- Reducir textos tecnicos y paneles introductorios, mostrar feedback real de guardado/error y conservar formularios cuando una operacion falla.
- Para uso en emergencias, valorar consulta sin conexion de cajas asignadas con fecha de ultima sincronizacion. Las modificaciones offline requieren reglas explicitas de conflicto; no deben anadirse como una cache transparente de datos privados.

## Verificacion realizada

- `npm run typecheck`: correcto.
- Compilacion de produccion: correcta en una copia temporal aislada, con variables ficticias y las dependencias instaladas. No se ha tocado `.next` del servidor de desarrollo ni se ha probado conectividad real con Supabase.
- `npm run lint`: sale con codigo 1 y solicita configurar ESLint; no ofrece una verificacion automatica util.
- Reproducciones en memoria ejecutando el codigo TypeScript compilado con clientes de datos simulados: editor inactivo autorizado; escritura administrativa sin comprobacion de sede; perdida de ubicacion al fallar insercion; cron abierto sin secreto; correo omitido registrado como enviado; lector sin sede consultando globalmente. No son pruebas HTTP/RLS de extremo a extremo.
- Variables de avisos locales: las tres ausentes; no se han impreso valores de credenciales.
- Revision de SQL, acciones y UI: sin escrituras en Supabase ni envio de correos.

Pendiente para certificar el despliegue: comparar esquema real y migraciones, probar RLS con dos sedes y los tres roles, sesiones expiradas/revocadas, concurrencia de movimientos, correo con proveedor de pruebas, restauracion de copias y recorridos en movil. Las claves privilegiadas compartidas anteriormente en la conversacion deben sustituirse en su proyecto correspondiente; nunca incluir sus valores en el informe ni en Git.

## Orden de trabajo recomendado

1. Seguridad y estabilidad: autorizacion verificada, perfiles activos, aislamiento por sede, RLS, movimientos de ubicacion atomicos, avisos fiables y dependencias corregidas.
2. Inventario operativo: modelo/unidades/lotes, entradas y salidas, mantenimiento, edicion e historial, paginacion y busqueda.
3. Preparacion de intervenciones: cajas esperadas frente a reales, traslados, responsables, solicitudes, adjuntos y etiquetas QR definitivas.
4. Validacion movil y despliegue: usabilidad, accesibilidad, tiempos medidos, copias/restauracion y pruebas de aceptacion con las sedes.

Antes de implementar los flujos nuevos hay que concretar si el editor solo crea fichas o tambien registra consumos, movimientos y reparaciones. El requisito anterior decia solo crear; el codigo actual permite varias modificaciones y las politicas de inventario usan `FOR ALL`, incluido borrado. El rol no deberia ampliarse implicitamente por necesidades de interfaz.
