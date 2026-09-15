create table if not exists public.notification_preferences (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  notification_email text not null,
  expiry_warning_days integer not null default 14 check (expiry_warning_days between 1 and 365),
  email_notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  alert_type text not null check (alert_type in ('expiry', 'low_stock', 'maintenance')),
  sent_for_date date not null,
  sent_at timestamptz not null default now(),
  unique (profile_id, item_id, alert_type, sent_for_date)
);

create unique index if not exists alerts_item_type_date_unique
on public.alerts (item_id, alert_type, trigger_date);

drop trigger if exists set_notification_preferences_updated_at on public.notification_preferences;
create trigger set_notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;
alter table public.notification_events enable row level security;

drop policy if exists "Users can read their own notification preferences" on public.notification_preferences;
create policy "Users can read their own notification preferences"
on public.notification_preferences
for select
to authenticated
using (profile_id = auth.uid() or public.user_role() = 'admin');

drop policy if exists "Users can manage their own notification preferences" on public.notification_preferences;
create policy "Users can manage their own notification preferences"
on public.notification_preferences
for all
to authenticated
using (profile_id = auth.uid() or public.user_role() = 'admin')
with check (profile_id = auth.uid() or public.user_role() = 'admin');

drop policy if exists "Users can read their own notification events" on public.notification_events;
create policy "Users can read their own notification events"
on public.notification_events
for select
to authenticated
using (profile_id = auth.uid() or public.user_role() = 'admin');

