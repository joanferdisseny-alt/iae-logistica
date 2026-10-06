# General inventory import

## Deployment

Run `supabase/upgrade-inventory-import.sql` in the Supabase SQL Editor as postgres for an existing installation. It is generated, transactional and migration-tracked, including prerequisites. Do not run `install.sql` against an existing database. No live migration or stock import is performed by the implementation/tests.

## Operator workflow

1. Open Catalogo > Importar stock and upload CSV (UTF-8, comma/semicolon/tab) or flat XLSX (one nonempty sheet). The first row contains unique headers; each following row describes one article. Limits: 1 MB compressed file, 8 MB expanded XLSX, 500 rows, 40 columns, 2,000 characters per cell.
2. Review suggested column mappings. Assign quantity and at least name, SKU or UUID. New articles need name/category; subcategory paths use `>` between levels. Additional columns become typed fields with an editable reusable key. Existing select fields keep their configured options and per-type restrictions; new selects must be configured before import.
3. Select the site, destination and unique receipt reference. Each load has one destination (unassigned, physical location OR box). Split files for separate destinations or repeated articles with different lots. Existing stock elsewhere remains untouched.
4. Review every new article or stock addition, totals before/after, lot/expiry and structure changes. Confirm only quantities not already registered. This is an **incoming quantity**, not a replacement snapshot. An empty quantity fails; zero can create a catalogue article without stock.

`public/plantilla-inventario.csv` is a fictitious zero-stock example. Keep codes as text in Excel to preserve leading zeros. Dates use `YYYY-MM-DD`, quantities have at most 3 decimal places and no thousands separators. Core data mappings cannot be disguised as custom technical fields.

The previous uniformity matrix importer remains available for the NGO's original file, with blanks meaning nonexistent sizes. Its initial-load restrictions are unchanged. For subsequent receipts use the general importer with the existing article SKU. Neither stock importer creates volunteers or historical clothing deliveries.

## Identity and structure

- A supplied UUID must exist in the selected site. It is never treated as a new external identifier. Use SKU for external codes.
- SKU comparison is case-insensitive within the site. Multiple matches fail; a supplied UUID/SKU disagreement fails. An unknown SKU explicitly creates a new article, visible in the review.
- Without either identifier, the importer only reuses an article on a unique exact combination of normalized name, category and complete technical characteristics (plus type if specified). Different or missing characteristics under an existing name are ambiguous: provide the existing SKU/ID or a new SKU to deliberately create a different article. Category/field similarity alone is never product identity.
- Category hierarchy matches name or code at each parent; ambiguous names fail. Types match name/code in their category. Without a type, an identified article retains its current type; otherwise a unique exact custom-field-key set can identify a reusable type. If none matches, use/create the leaf-category name as type. Ambiguous types require an explicit type/code.
- Field definitions reuse their exact keys and compatible types. Missing fields and optional assignments can be created, explicitly listed in the review. Required fields and select restrictions remain enforced. The import does not update existing article descriptions, characteristics, units, category, minimum stock or serials; conflicting supplied values fail.
- New articles without a SKU receive a stable generated `IMP-...` reference, visible before confirmation. Use that reference on later receipts.
- Each row receives a stock lot, using the provided lot code or a receipt-derived code. A reused lot must have the same expiry and no brand variant; brand-specific packaged barcode receipts remain in Recibir material. Required lot expiry and serial-stock limits are enforced. QR URLs for articles/positions/boxes remain unchanged.

## Transaction and security model

Only a verified active administrator can upload, preview or confirm. Public SQL RPCs recheck the same role. Drafts are immutable and owned by the creating admin; table writes and the shared internal executor are not granted to clients. All functions use an empty search_path and fully qualified application relations.

Preview executes the actual catalogue/stock logic in a PostgreSQL subtransaction, then deliberately raises a private exception to roll back all business writes. PL/pgSQL local plan variables survive the rollback. This validates existing triggers, required fields, serialized quantities, lots and destinations with exactly the same logic as commit. Only the draft is persisted. Do not attach nontransactional external side effects to catalogue/stock triggers; notifications/jobs must be emitted after commit.

Confirmation takes the shared inventory advisory lock, executes the same logic and compares the entire resulting plan to the reviewed one. Any discrepancy rolls back the whole transaction, including earlier rows. Changed relevant balances, identities or schema require a fresh preview. Retries of a committed draft return its saved result. A partial unique index prevents a receipt reference from being committed twice in one site, even from separately prepared drafts. Different references represent different deliveries, so deliberately importing identical quantities with a new reference is allowed. The system does not infer receipt identity from file contents alone.

Uncommitted previews expire after 7 days. Committed drafts retain the payload, reviewed plan, reference, author and time; article history records the reference/row, and stock operations use the existing movement/position infrastructure. No production data is used in tests.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`. PGlite integration tests cover complete rollback, idempotency, duplicate receipt references/rows, strict matching, distributed stock preservation, lots, serials, headquarters isolation and privileges. Parser tests cover column mapping, encodings, delimiters, dates, decimals, reserved keys and size bounds. Test production builds in an isolated source copy when a development server is active.
