# Inventory notification cron

Endpoint: `GET /api/cron/expiry-alerts`. `vercel.json` schedules 07:00 UTC daily.
No deployment, remote database writes or real email sends are part of local validation.

## Configuration and recipients

- `CRON_SECRET` is mandatory. Authenticate with `Authorization: Bearer <secret>` or the existing `x-cron-secret` header. No admin import/client creation happens before authentication.
- `RESEND_API_KEY` and `ALERTS_FROM_EMAIL` are mandatory. The sender accepts a plain email or `Name <email>`. Missing/invalid configuration returns 503 without database activity or email submission.
- Only enabled `notification_preferences` belonging to active profiles with a known role and either administrator role or `is_logistics_contact = true` are recipients. Email and the 1-365 day expiry window are validated. Invalid recipient configuration reports an explicit failure and creates no event for that recipient.
- Subscribed administrators receive all headquarters without needing the contact flag; other recipients must be logistics contacts with a headquarters and only receive its items. Ordinary readers/editors do not receive emails even with enabled preferences. Administrators alone configure preferences. The contact flag does not grant global scope or bypass an email opt-out, and setting it never creates email preferences. No Auth email fallback is used.
- Administrators configure each recipient from Users, including the logistics contact flag and explicit notification preferences. The cron consumes these rows but never opts users in automatically.

## Existing schema contract

Uses existing columns in `notification_preferences`, `notification_events`, `alerts`, `profiles`, `app_roles`, `inventory_items`, `inventory_container_items`, `inventory_containers`, and `locations`. No SQL is written by this module.

The `operational_status` field is supplied by migration `202609140001_security_and_operations.sql`. Deploy the combined upgrade before this cron. Legacy maintenance records become `inspection`; administrators can then distinguish actual repairs. Missing schema and database failures are reported explicitly, never treated as empty results.

The existing unique keys are required:

- `alerts(item_id, alert_type, trigger_date)`.
- `notification_events(profile_id, item_id, alert_type, sent_for_date)`.

## Alert semantics

- Expiry includes overdue dates and dates within each recipient's window. Global alerts use at least 14 days, extended to the largest valid subscriber window even if no subscribers exist. An expiry is notified once per item, recipient and expiration date, not again just because it becomes overdue.
- Low stock means `current_stock <= minimum_stock`, with a defined minimum. It generates a daily UTC reminder while low, including zero stock.
- Maintenance includes due/overdue `maintenance_due_at`, `repair` and `inspection`. A dated maintenance alert is notified once per due date. Maintenance without a date generates a daily UTC reminder. A future due date alone does not trigger an early maintenance reminder.
- Retired items generate none of the three alert types.
- Alert creation does not depend on having email subscribers. Existing alert rows are inserted with conflict-ignore, so resolved/dismissed states are not reopened. The cron does not automatically resolve alert rows when stock or condition improves.
- A box overrides a stale direct location. Its full ancestor location path is included. Cycles, multiple boxes, missing location data or headquarters mismatches block that email with an explicit integrity error. All interpolated email content is HTML-escaped.

## Acceptance and idempotency

One email per recipient/item/type/date uses a stable SHA-256 `Idempotency-Key`. The key does not depend on run time, array order, recipient address, stock values or random IDs. Read failures prevent sending. Provider errors, conflicts, timeouts, and malformed success responses never create `notification_events`.

Events are inserted only after Resend returns success with an acceptance ID. The response distinguishes `acceptedEmails` (successful provider responses, including idempotent replays) from `recordedEvents` (new rows inserted). Neither counter proves final delivery or counts globally unique deliveries across concurrent runs. Duplicate event insertion from a concurrent successful run is harmless. Other event write errors produce `event_write_after_acceptance` and HTTP 500.

Resend retains keys for 24 hours: <https://resend.com/docs/dashboard/emails/idempotency-keys>. An accepted email followed by a database failure must be investigated/retried within that window. The existing schema cannot guarantee exactly-once delivery after it expires. Retries with changed item/location/recipient content can receive HTTP 409 for the same key; the cron reports this rather than changing the key and risking a duplicate. Rate limits and concurrent-provider conflicts are explicit failures without automatic retry. Persisted events prevent later resends once recording succeeds.

Errors include stage, affected IDs, type and sanitized database/provider codes, not secrets or provider response bodies. Any failure yields HTTP 500 with counters; the failure list is capped at 100 and `failureCount` remains complete. There is no external error monitor, webhook delivery tracking or persistent outbox in this change. Large inventories use paginated reads but sequential emails/database writes can exceed a deployment's execution limit; monitor duration before production rollout.

## Local verification

Run `node --test tests/notifications.test.cjs`. Tests transpile the owned TypeScript in memory, use an in-memory Supabase query mock and a fake Resend provider, and never import the real admin client or send network traffic. They cover authorization order, missing configuration, active users/scope, all alert types, overdue dates, HTML/placement integrity, failures, pagination and concurrency.

Run an isolated type check with `./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target es2022 --module node16 --moduleResolution node16 lib/notifications/cron.ts`.

Audit corrections covered: A05, A06, the email-location portion of A09 and the notification coverage gaps. The audit file is outside this agent's exclusive ownership and is intentionally not edited here. SQL/RLS, production joins, actual Resend credentials and Vercel deployment remain unverified.
