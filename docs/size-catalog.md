# Uniformidad: una ficha por prenda

## Despliegue

1. Haz una copia de seguridad de la base de datos.
2. Ejecuta `supabase/upgrade-size-catalog.sql` en SQL Editor del proyecto correcto, como postgres. El archivo incluye los requisitos previos y omite las migraciones ya registradas. No uses `install.sql` en una base existente.
3. Despliega la aplicacion. Si falta la vista nueva, el inventario muestra un aviso explicito, no un catalogo parcial.
4. No vuelvas a importar el Excel. La nueva vista agrupa automaticamente las existencias ya cargadas y las futuras cargas de uniformidad.

La implementacion y las pruebas no aplican cambios en Supabase ni importan datos de produccion.

## Modelo

`inventory_catalog_items` es una vista de solo lectura con `security_invoker=true`: respeta los permisos RLS de los articulos originales. El listado cuenta, busca y pagina productos agrupados en SQL, no las primeras 50 variantes en el navegador.

El importador de uniformidad crea un tipo de prenda identificado por `uniformidad_<hash de equipacion y prenda>`. Solo esos tipos con `technical_specs.uniformidad_talla` se agrupan por plantilla, sede, categoria y unidad. No se agrupan productos por un nombre parecido ni articulos de plantillas genericas; tampoco se suman sedes o unidades diferentes. Un importador general con otras plantillas sigue gestionando articulos individuales.

Cada producto muestra su stock total y las tallas existentes. Un cero se conserva como talla sin stock; una celda vacia no crea una talla. Los registros de `inventory_items` se mantienen como referencias de stock por talla. No se eliminan ni reescriben IDs, SKU, codigos de barras, lotes, ubicaciones, entregas, relaciones, documentos o historiales. Las operaciones siguen recibiendo el ID de la talla elegida, nunca el total de la prenda.

La ficha agrupada tiene un QR de prenda y enlaces a cada talla. Todos los QR de articulo y posicion existentes siguen abriendo los mismos registros; un QR de existencias continua identificando su talla, lote y destino. Los documentos e historiales mostrados bajo la seleccion corresponden a la talla elegida.

Las alertas se calculan por variante: una talla con stock bajo no queda oculta porque otra tenga unidades. El listado muestra varios estados si las tallas tienen estados operativos diferentes; el filtro de estado encuentra cualquiera de las tallas.

## Comprobacion

- `npm test`: incluye migracion sobre datos existentes, repeticion sin modificaciones de stock, nuevas importaciones, aislamiento entre sedes y roles, consultas por antiguos IDs, entregas/devoluciones y renderizado del desglose.
- `UNIFORMITY_XLSX='/ruta/INVENTARIO UNIFORMIDAD.xlsx' node --test tests/uniformity.database.test.cjs`: importa una copia del Excel en una base aislada. El archivo facilitado produce 14 fichas, 54 variantes existentes y 558 unidades; las 44 celdas vacias no crean variantes.
- `npm run typecheck` y `npm run lint`.
