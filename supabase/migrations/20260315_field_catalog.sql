create table if not exists public.inventory_fields (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'date', 'textarea', 'select', 'boolean')),
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.inventory_fields enable row level security;

drop policy if exists "Fields readable by authenticated users" on public.inventory_fields;
create policy "Fields readable by authenticated users"
on public.inventory_fields
for select
to authenticated
using (true);

drop policy if exists "Admins manage fields" on public.inventory_fields;
create policy "Admins manage fields"
on public.inventory_fields
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

alter table public.inventory_template_fields
add column if not exists field_id uuid references public.inventory_fields (id) on delete cascade;

insert into public.inventory_fields (field_key, label, field_type, options)
select distinct
  field_key,
  label,
  field_type,
  options
from public.inventory_template_fields
where field_key is not null
on conflict (field_key) do update
set
  label = excluded.label,
  field_type = excluded.field_type,
  options = excluded.options;

update public.inventory_template_fields tf
set field_id = f.id
from public.inventory_fields f
where tf.field_key = f.field_key
  and tf.field_id is null;

create unique index if not exists inventory_template_fields_template_field_id_idx
on public.inventory_template_fields (template_id, field_id)
where field_id is not null;

drop policy if exists "Admins manage templates" on public.inventory_templates;
create policy "Admins manage templates"
on public.inventory_templates
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

drop policy if exists "Admins manage template fields" on public.inventory_template_fields;
create policy "Admins manage template fields"
on public.inventory_template_fields
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');
