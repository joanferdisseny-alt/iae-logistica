# IAE Logistica

Aplicación de inventario y logística para una ONG dedicada al rescate, construida con Next.js, Supabase y pensada para desplegarse en Vercel.

## Funcionalidad

- Inventario por sede, categorías y subcategorías, fichas configurables, ubicaciones y cajas.
- Roles, responsables de logística y solicitudes con historial.
- Movimientos de stock, estado operativo, mantenimiento y caducidad.
- Documentos privados y enlaces a manuales, QR y alertas por correo.
- Checklists de retorno por caja para entrenamientos e intervenciones, con incidencias e historial por sede.
- Reparto de existencias por lote entre varias cajas y ubicaciones dentro de cada sede.

## Actualizar el proyecto existente

Para activar las subcategorías, ejecuta `supabase/upgrade-category-hierarchy.sql` completo en SQL Editor del proyecto Supabase de la aplicación, antes de desplegar este código. Conserva el catálogo existente y registra las migraciones para no repetirlas. No uses `install.sql` sobre una base con datos. Haz una copia de seguridad antes de actualizar.

En **Fichas > Categorías**, el administrador puede elegir una categoría superior al crear o editar. La tabla y los selectores muestran la ruta completa. El filtro del inventario incluye las subcategorías; no se puede eliminar una categoría con subcategorías, fichas o artículos asociados. Los campos siguen siendo configurables por ficha, sin herencia automática entre categorías.

La importación CSV/Excel de existencias, voluntarios y entregas queda pendiente de recibir un archivo de muestra. No se han precreado categorías ni campos de Uniformidad: se definirán según sus columnas y contenido real. Antes de importar habrá que acordar identificadores, tallas, sedes y cómo distinguir stock disponible de material ya entregado para evitar duplicados. Tampoco se han creado cuentas ni enviado invitaciones.

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
