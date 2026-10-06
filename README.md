# IAE Logistica

Aplicación de inventario y logística para una ONG dedicada al rescate, construida con Next.js, Supabase y pensada para desplegarse en Vercel.

## Funcionalidad

- Inventario por sede, categorías y subcategorías, fichas configurables, ubicaciones y cajas.
- Roles, responsables de logística y solicitudes con historial.
- Movimientos de stock, estado operativo, mantenimiento y caducidad.
- Documentos privados y enlaces a manuales, QR y alertas por correo.
- Checklists de retorno por caja para entrenamientos e intervenciones, con incidencias e historial por sede.
- Reparto de existencias por lote entre varias cajas y ubicaciones dentro de cada sede.
- Importación inicial de uniformidad (Excel/CSV), voluntarios, entregas históricas y nuevas, devoluciones y acceso personal.

## Actualizar el proyecto existente

Para activar Uniformidad y el acceso personal, ejecuta `supabase/upgrade-uniformity.sql` completo en SQL Editor del proyecto Supabase de la aplicación, antes de desplegar este código. Incluye las subcategorías y las actualizaciones anteriores. Conserva el catálogo existente y registra las migraciones para no repetirlas. No uses `install.sql` sobre una base con datos. Haz una copia de seguridad antes de actualizar.

En **Fichas > Categorías**, el administrador puede elegir una categoría superior al crear o editar. La tabla y los selectores muestran la ruta completa. El filtro del inventario incluye las subcategorías; no se puede eliminar una categoría con subcategorías, fichas o artículos asociados. Los campos siguen siendo configurables por ficha, sin herencia automática entre categorías.

### Carga inicial de uniformidad

1. Tras actualizar Supabase, entra como administrador en **Importar uniformidad** y selecciona el Excel de existencias. No se modifica el stock al analizar el archivo.
2. Revisa todas las filas de la vista previa, selecciona la sede propietaria y, si se conoce, la ubicación física o caja de destino. No se asigna una sede por defecto.
3. Confirma que las cantidades son únicamente stock disponible en almacén, sin incluir material ya entregado. La importación se ejecuta en una única transacción.

Se crea **Uniformidad > Primera uniformidad / Segunda uniformidad**, una ficha por prenda y un artículo por talla existente. Una celda vacía significa que esa talla no existe para la prenda y se omite. Un cero explícito crea la talla sin existencias. Las tallas de cada ficha quedan restringidas a las presentes en el archivo, no a todas las tallas del catálogo global.

Se admite el formato de bloques del Excel facilitado (XS, S, M, L, XL, XXL, SIN TALLA), o una tabla Excel/CSV UTF-8 con cabeceras `UNIFORMIDAD,PRENDA,TALLA,CANTIDAD`; uniformidad debe ser `PRIMERA UNIFORMIDAD` o `SEGUNDA UNIFORMIDAD`. Límite: 1 MB, 2000 artículos y unidades enteras no negativas. Filas ambiguas, tallas desconocidas y duplicados se rechazan, no se corrigen silenciosamente.

Repetir el mismo contenido en la misma sede y destino no duplica existencias. Un archivo modificado que solape artículos importados se rechaza completo: la carga inicial no sobrescribe ni suma stock previo. Para reposiciones posteriores se usa Recepción o movimientos. La base conserva lote de importación, origen de cada celda y cantidades iniciales.

### Voluntarios y entregas

- **Voluntarios y entregas** permite registrar personal por código único, sede y correo opcional, sin crear cuentas ni enviar invitaciones. La cuenta se crea en **Usuarios** y se vincula explícitamente por nombre desde la ficha del voluntario. El correo por sí solo nunca enlaza cuentas.
- El nuevo rol **Voluntario (acceso personal)** solo puede consultar su material y sus solicitudes. No es equivalente a Lector: no accede al inventario interno ni al de otras sedes. Administradores, editores y lectores conservan sus permisos anteriores.
- Una **entrega histórica** registra ropa que ya tenía la persona y no resta stock del almacén. La fecha puede quedar vacía si se desconoce.
- Una **nueva entrega** requiere fecha y existencia de origen; descuenta stock y registra la entrega de forma atómica. Las devoluciones reponen el destino elegido y no pueden exceder lo pendiente. Solo debe devolverse al stock material reutilizable.
- En **Mi material**, el usuario vinculado ve sus entregas y cantidades pendientes; puede pedir material indicando prenda, talla y cantidad. Logística tramita esas solicitudes por el circuito habitual. Marcar una solicitud como completada no registra una entrega automáticamente: esta se registra desde la ficha del voluntario.

La importación masiva del archivo de voluntarios y entregas queda pendiente de recibir su estructura real (identificador estable, sede, correo, prenda, talla, cantidad y fecha si existe). La base y la gestión manual están preparadas; no se inventan personas, identificadores o entregas a partir del Excel de almacén. No se modifica Supabase remoto al instalar o arrancar el código.

Para el reparto de existencias, el archivo vigente es `supabase/upgrade-distributed-stock.sql`. Conserva las cantidades actuales y actualiza movimientos, cajas, checklists y avisos. Sigue [la guía de existencias repartidas](docs/distributed-stock.md). No se ejecuta automáticamente al arrancar la aplicación.

Sigue [la guía de actualización](docs/actualizacion-2026-09-14.md). El archivo actual para bases existentes es `supabase/upgrade-2026-09-15.sql`: incluye también la referencia de artículos en solicitudes y omite las migraciones anteriores ya registradas. Hay cambios de base de datos obligatorios: ejecutar solamente el código nuevo no es suficiente. No uses el instalador de una base vacía sobre los datos actuales.

Para activar los checklists, ejecuta `supabase/upgrade-checklists-2026-09-15.sql`. Incluye todas las actualizaciones anteriores y registra cada migración para no repetirla. Consulta [uso y permisos de los checklists](docs/checklists.md).

## Primer arranque

1. Configura las variables de entorno usando [.env.example](/Users/joanferriscervero/Downloads/iae-logistica/.env.example).
2. En una base vacía, ejecuta [install.sql](supabase/install.sql) en Supabase.
3. Instala dependencias con `npm install`.
4. Arranca con `npm run dev`.

## Documentación

- Setup completo: [setup.md](/Users/joanferriscervero/Downloads/iae-logistica/docs/setup.md)
- Avisos de seguridad de Supabase: [correccion y avisos intencionados](docs/supabase-security-warnings.md).
- Checklists: [activación, flujo de retorno y límites](docs/checklists.md).
- Devoluciones con QR: [etiquetas por caja/lote y confirmación de cantidades](docs/checklist-qr.md).
- Existencias: [reparto por lotes y ubicaciones](docs/distributed-stock.md).
- Conexion de Supabase: [comprobacion diaria independiente del correo](docs/database-check.md).

## Verificación local

`npm test`, `npm run typecheck`, `npm run lint` y `npm run build`.
No ejecutes el build contra la misma carpeta `.next` de un servidor de desarrollo en marcha.
Los tests de SQL usan PostgreSQL local en memoria (PGlite), sin tocar Supabase ni enviar correos.
Regenera los instaladores después de modificar las migraciones con `node scripts/build-sql.cjs`.
# Recepcion por codigo de barras

Nueva pantalla **Recepcion**: camara o lector USB, codigos por sede, variantes de marca/modelo, envases y reparto atomico por cajas/ubicaciones. Para activar en una base existente ejecuta `supabase/upgrade-barcode-receiving.sql`. Consulta [el flujo, permisos y comprobaciones](docs/barcode-receiving.md). La camara del movil necesita HTTPS; no se ha modificado la base remota automaticamente.

## Busqueda de codigos

En Recepcion los codigos se buscan exclusivamente en el inventario de la sede. Los articulos nuevos se crean manualmente con una ficha existente o se solicitan a logistica. La busqueda en internet se ha retirado; no requiere claves ni configuracion de proveedores. Se conserva el historial anterior y la compatibilidad con altas pendientes. Consulta [la retirada de la busqueda online](docs/product-research-retired.md).
