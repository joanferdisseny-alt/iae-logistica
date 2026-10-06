# ERP workspace

## Navigation

- Catalogo: articulos, categorias y subcategorias, tipos de articulo (antes fichas), campos e importacion de stock.
- Almacen: recepcion por codigo de barras, cajas/kits, ubicaciones fisicas, checklists y solicitudes.
- Personas: voluntarios/entregas y material personal.
- Configuracion: sedes, usuarios y permisos.

`lib/navigation.ts` contains the navigation model. This is presentation only: every server page/action still checks its own permissions. Volunteers only see their personal material and requests.

Existing route URLs, including QR links, are unchanged. The shared shell owns contextual tabs. The sidebar remembers its collapsed state locally; mobile uses a native modal dialog with Escape, focus restoration and background scroll lock.

## Catalog workflow

Categories organize products. Article types define reusable forms; they do not represent physical stock. Fields are reusable characteristics assigned to those types. Create a real article from the inventory table, choosing its type, site and initial stock destination. Later distribution among boxes/locations remains in the article detail.

Category and type creation suggests a code based on the name, while allowing an explicit override. Existing codes are not renamed. A subcategory can be created directly from its parent row. Configuration searches cover the entire RLS-visible catalogue loaded by paginated reads; inventory search remains server-side across all accessible items.

## Import workflow

The current stock importer supports **uniformity only**, using its existing XLSX/CSV formats and atomic/idempotent SQL operation. The steps are file, preview, site/destination and result. File analysis stores a draft but does not modify stock. Confirmation still requires acknowledging that quantities exclude clothing already issued. Blank sizes are omitted; explicit zeroes remain available sizes with zero stock.

`public/plantilla-uniformidad.csv` is an example structure with fictitious names and zero stock. It is not the NGO inventory. Volunteer and historical-delivery imports remain in the volunteers section; no generic arbitrary-column stock mapper is implied by this redesign.

## Performance and safety

The inventory listing no longer fetches templates/fields, the container selector or notification preferences. These are read on opening the respective dialog, with a fresh server-side permission check and complete pagination. Forms are dynamically imported. A failure in a creation-only catalogue no longer prevents reading stock. The normal listing fixture now requires five reads rather than eight (auth excluded; larger catalogues can require additional pages).

Reception and import destination reads run concurrently. Sidebar/context-tab links do not eagerly prefetch every protected page. No shared user-data cache or weaker session verification was introduced. No database migration is required for this workspace change.

## Verification

Run `npm test`, `npm run typecheck` and `npm run lint`. Build in an isolated source copy if a development server is running, to avoid overwriting its `.next` output. UI checks use fictitious data, not production stock: desktop collapse persistence, mobile overflow/menu/focus, lazy forms, category searches, suggested codes, subcategory parent and file-preview-destination workflow.

The production database and email/QR camera hardware need their own end-to-end validation; local fixture timings are not production latency measurements.
