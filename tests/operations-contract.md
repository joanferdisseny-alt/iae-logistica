# Contrato del flujo operativo

## Acceso y alcance

`lib/auth/context.ts` exporta `requireAccess()` sin argumentos. Resuelve
`{ supabase, user, profile, roleCode, isAdmin }`, con `user.id` y
`profile.headquarters_id: string | null`. Debe rechazar usuarios sin sesion,
perfiles inactivos y usuarios sin sede salvo administradores.

Las tres acciones nuevas exigen `isAdmin` y comprueban que el articulo existe
con el cliente autenticado. No utilizan service role. Las RPC y RLS deben
revalidar los permisos, incluso en invocaciones directas. No se modifica la
creacion de articulos de los editores.

El detalle filtra el articulo por la sede del perfil no administrador. Solo
despues carga relaciones, ubicacion actual, adjuntos e historiales. Los catalogos
de opciones se consultan exclusivamente para administradores y se filtran por
`item.headquarters_id`, no por la sede del administrador. Las relaciones visibles
tienen el mismo filtro de sede. Cada historial muestra 50 registros por pagina,
ordenados por `created_at desc, id desc`; `?historyPage=N` pagina ambos.

## Acciones y RPC

Las exportaciones de `app/dashboard/inventory/operations.ts` son server actions:

```ts
recordMovement(previous: OperationState | undefined, formData: FormData): Promise<OperationState>
updateItem(previous: OperationState | undefined, formData: FormData): Promise<OperationState>
addAttachment(previous: OperationState | undefined, formData: FormData): Promise<OperationState>

type OperationState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  retrySameRequest?: boolean;
};
```

`recordMovement` recibe `itemId`, `type`, `quantity`, `notes`, `requestId`:

```sql
record_inventory_movement(
  p_item_id uuid,
  p_type text,
  p_quantity numeric,
  p_notes text,
  p_request_id uuid
) returns numeric
```

- `type`: `in`, `out` o `adjustment`.
- `quantity`: decimal no negativo; entradas/salidas estrictamente positivas.
- `adjustment` transmite el stock final contado, incluido cero; no un delta.
- Cantidades y stock minimo: hasta `99999999999.999` y tres decimales
  significativos tras el separador, coherente con `numeric(14,3)`. Se admite coma
  o punto y se normalizan ceros; se transmiten cadenas decimales al parametro
  numeric de PostgREST, sin aritmetica ni redondeo en JavaScript.
- `notes`: obligatorio, recortado, de 3 a 2000 caracteres.
- `itemId` y `requestId`: UUID validos. El navegador genera el UUID al primer
  envio de la operacion y conserva UUID y payload ante respuesta incierta.
  Impide doble envio concurrente y bloquea editar ese payload durante el
  reintento. Cerrar/reabrir el popup conserva la solicitud; una recarga completa
  de la pagina no la persiste. Tras una recarga incierta debe revisarse el historial.
- La RPC debe garantizar atomicidad, bloqueo de stock, no saldo negativo,
  unicidad de `request_id`, repeticion sin nuevo movimiento para igual UUID y
  payload, y rechazo si el UUID se reutiliza con datos distintos.
- La RPC inserta `movement_type`, cantidad solicitada (recuento final para
  adjustment), motivo, `created_by = auth.uid()`, `balance_after` y `request_id`.
  El cliente no depende del saldo devuelto: recarga la ficha tras exito.
- La RPC sincroniza la cantidad de la caja al saldo completo si es positivo y
  elimina `inventory_container_items` del articulo cuando el saldo es cero.

`updateItem` recibe `itemId`, `name`, `description`, `status`, `maintenanceDueAt`,
`expirationDate`, `minimumStock`, `notes`:

```sql
update_inventory_item(
  p_item_id uuid,
  p_name text,
  p_description text,
  p_status text,
  p_maintenance_due_at date,
  p_expiration_date date,
  p_minimum_stock numeric,
  p_notes text
) returns void
```

- `p_status` es el estado OPERATIVO: `available`, `in_use`, `repair`,
  `inspection` o `retired`; escribe `operational_status`, no el `status`
  calculado de alertas. Ambos estados se muestran por separado en la ficha.
- Nombre recortado de 2 a 200 caracteres; descripcion hasta 5000 caracteres.
- Descripcion, fechas y minimo vacios se envian como `null`, permitiendo borrar
  valores anteriores. Las fechas no vacias son fechas reales `YYYY-MM-DD`.
- Motivo obligatorio de 3 a 2000 caracteres. La RPC actualiza la ficha y crea
  su entrada de auditoria en una misma transaccion; nunca el cliente.

Ambas RPC comunican fallo mediante error PostgREST/excepcion SQL, no devolviendo
un objeto `{error}` con HTTP exitoso. No se requiere otro formato de retorno.
Tras exito se invalidan detalle, listado y `/dashboard`. Los movimientos tambien
invalidan `/dashboard/locations` con ambito `layout` para refrescar las cajas.

## Tablas consultadas

Se mantienen los campos y joins anteriores de `inventory_items`, `locations`,
`inventory_templates`, `inventory_containers`, `inventory_container_items` e
`inventory_item_relations`. Se requiere adicionalmente:

```text
inventory_items: headquarters_id uuid nullable, operational_status text not null
inventory_movements: id, item_id, movement_type, quantity numeric,
  notes, created_by, created_at, balance_after numeric nullable, request_id uuid nullable
inventory_item_history: id, item_id, actor_id nullable, event_type text,
  details jsonb, created_at
inventory_attachments: id, item_id, title text, url text, created_by, created_at
```

Los campos nuevos de movimientos pueden ser nulos en registros antiguos. La
auditoria muestra `event_type` y el JSON `details` sin asumir un esquema cerrado;
es compatible con `{before, status, notes}` de la RPC actual. Los actores se
muestran por UUID, sin consultas de perfiles ni correos.

`addAttachment` recibe `itemId`, `title`, `url` e inserta exclusivamente
`{item_id, title, url, created_by: user.id}` con el cliente autenticado. La tabla
debe generar `id` y `created_at` por defecto. Se exige titulo recortado de 1 a 200
caracteres y URL absoluta HTTPS de hasta 2048 caracteres, sin usuario/password,
en consonancia con la restriccion SQL HTTPS. No se exige extension `.pdf`: se
admiten manuales web y enlaces firmados. No se solicita, descarga ni sube el
destino. La lectura vuelve a validar el enlace antes de renderizarlo con
`target="_blank" rel="noopener noreferrer"`. RLS: consulta por articulo visible,
escritura solo admin.

## Ubicacion

El detalle usa el `ItemPlacementForm` existente solo para administradores y pasa
`currentStock={item.current_stock}`. Su accion `assignItemPlacement` y la RPC
`place_inventory_item` son propiedad del otro cambio y deben conservar la
restriccion server-side admin y la validacion de sede. Una fila representa toda
la unidad/partida; no se permite ubicar cantidades parciales desde este flujo.

## Verificacion local

`node --test tests/operations.test.cjs` ejecuta validaciones, contratos RPC,
permisos, filtros por sede y render del detalle con dobles locales. No prueba
transacciones reales, RLS, concurrencia SQL ni interacciones del navegador.
`npm run typecheck` comprueba la integracion TypeScript del proyecto.
