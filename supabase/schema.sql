create extension if not exists "pgcrypto";

create table if not exists public.app_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.headquarters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  address text,
  city text,
  province text,
  country text not null default 'España',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role_id uuid not null references public.app_roles (id),
  headquarters_id uuid references public.headquarters (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  headquarters_id uuid references public.headquarters (id),
  parent_location_id uuid references public.locations (id),
  location_type text not null default 'storage' check (location_type in ('room', 'cabinet', 'shelf', 'rack', 'vehicle', 'storage', 'other')),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_categories (
  code text primary key,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  template_id uuid,
  category text not null references public.inventory_categories (code),
  subtype text,
  description text,
  technical_specs jsonb not null default '{}'::jsonb,
  photo_urls text[] not null default '{}',
  sku text,
  serial_number text,
  headquarters_id uuid references public.headquarters (id),
  location_id uuid references public.locations (id),
  is_consumable boolean not null default false,
  minimum_stock integer,
  current_stock integer not null default 0,
  unit text,
  expiration_date date,
  maintenance_due_at date,
  status text not null default 'ok' check (status in ('ok', 'low', 'expired', 'maintenance')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category_code text not null references public.inventory_categories (code),
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_fields (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'date', 'textarea', 'select', 'boolean')),
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_template_fields (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.inventory_templates (id) on delete cascade,
  field_id uuid references public.inventory_fields (id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'date', 'textarea', 'select', 'boolean')),
  is_required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  unique (template_id, field_key)
);

alter table public.inventory_items
  drop constraint if exists inventory_items_template_id_fkey;

alter table public.inventory_items
  add constraint inventory_items_template_id_fkey
  foreign key (template_id) references public.inventory_templates (id);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  movement_type text not null check (movement_type in ('in', 'out', 'adjustment')),
  quantity integer not null,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_item_relations (
  id uuid primary key default gen_random_uuid(),
  source_item_id uuid not null references public.inventory_items (id) on delete cascade,
  target_item_id uuid not null references public.inventory_items (id) on delete cascade,
  relation_type text not null check (relation_type in ('uses', 'requires', 'compatible_with')),
  quantity_required integer,
  notes text,
  created_at timestamptz not null default now(),
  unique (source_item_id, target_item_id, relation_type)
);

create table if not exists public.inventory_containers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  container_type text not null default 'intervention' check (container_type in ('intervention', 'practice', 'storage', 'transport')),
  headquarters_id uuid not null references public.headquarters (id),
  location_id uuid references public.locations (id),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_container_items (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.inventory_containers (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (container_id, item_id)
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  alert_type text not null check (alert_type in ('expiry', 'low_stock', 'maintenance')),
  status text not null default 'open' check (status in ('open', 'dismissed', 'resolved')),
  trigger_date date not null,
  message text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

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

create index if not exists profiles_headquarters_id_idx
on public.profiles (headquarters_id);

create index if not exists inventory_items_headquarters_id_idx
on public.inventory_items (headquarters_id);

create index if not exists locations_headquarters_id_idx
on public.locations (headquarters_id);

create index if not exists inventory_containers_headquarters_id_idx
on public.inventory_containers (headquarters_id);

create index if not exists inventory_containers_location_id_idx
on public.inventory_containers (location_id);

create unique index if not exists inventory_container_items_one_container_per_item_idx
on public.inventory_container_items (item_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_headquarters_updated_at on public.headquarters;
create trigger set_headquarters_updated_at
before update on public.headquarters
for each row execute function public.set_updated_at();

drop trigger if exists set_inventory_items_updated_at on public.inventory_items;
create trigger set_inventory_items_updated_at
before update on public.inventory_items
for each row execute function public.set_updated_at();

drop trigger if exists set_locations_updated_at on public.locations;
create trigger set_locations_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

drop trigger if exists set_inventory_containers_updated_at on public.inventory_containers;
create trigger set_inventory_containers_updated_at
before update on public.inventory_containers
for each row execute function public.set_updated_at();

insert into public.app_roles (code, name, description)
values
  ('admin', 'Administrador', 'Gestiona usuarios, permisos y catálogo.'),
  ('editor', 'Editor', 'Crea y actualiza inventario de su sede.'),
  ('reader', 'Lector', 'Consulta el inventario de su sede.')
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description;

insert into public.headquarters (name, slug, city, province, country)
values
  ('Valencia', 'valencia', 'Valencia', 'Valencia', 'España'),
  ('Melilla', 'melilla', 'Melilla', 'Melilla', 'España'),
  ('Galicia', 'galicia', null, 'Galicia', 'España'),
  ('Navarra', 'navarra', null, 'Navarra', 'España')
on conflict (slug) do update
set
  name = excluded.name,
  city = excluded.city,
  province = excluded.province,
  country = excluded.country;

insert into public.inventory_categories (code, name, description)
values
  ('tool', 'Herramienta', 'Herramientas operativas y eléctricas.'),
  ('material', 'Material', 'Material técnico y reutilizable.'),
  ('food', 'Comida', 'Alimentos y productos con caducidad.'),
  ('consumable', 'Consumible', 'Elementos fungibles y de reposición.')
on conflict (code) do nothing;

insert into public.inventory_templates (code, name, category_code, description)
values
  ('tool_drill', 'Taladro / herramienta eléctrica', 'tool', 'Ficha técnica para herramientas eléctricas con potencia y compatibilidades.'),
  ('consumable_drill_bits', 'Brocas / consumible asociado', 'consumable', 'Consumibles compatibles con herramientas, con medida y material.'),
  ('material_rescue_kit', 'Material de rescate', 'material', 'Material técnico con certificación o especificaciones operativas.'),
  ('food_animal_feed', 'Comida / pienso', 'food', 'Ficha de alimentos con lote, especie y formato.')
on conflict (code) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_role_id uuid;
begin
  select id into default_role_id
  from public.app_roles
  where code = 'reader';

  insert into public.profiles (id, full_name, role_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    default_role_id
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.user_role()
returns text
language sql
stable
as $$
  select ar.code
  from public.profiles p
  join public.app_roles ar on ar.id = p.role_id
  where p.id = auth.uid()
$$;

create or replace function public.user_headquarters_id()
returns uuid
language sql
stable
as $$
  select p.headquarters_id
  from public.profiles p
  where p.id = auth.uid()
$$;

alter table public.app_roles enable row level security;
alter table public.headquarters enable row level security;
alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.inventory_categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_templates enable row level security;
alter table public.inventory_fields enable row level security;
alter table public.inventory_template_fields enable row level security;
alter table public.inventory_item_relations enable row level security;
alter table public.inventory_containers enable row level security;
alter table public.inventory_container_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.alerts enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_events enable row level security;

drop policy if exists "Roles readable by authenticated users" on public.app_roles;
create policy "Roles readable by authenticated users"
on public.app_roles
for select
to authenticated
using (true);

drop policy if exists "Headquarters readable by authenticated users" on public.headquarters;
create policy "Headquarters readable by authenticated users"
on public.headquarters
for select
to authenticated
using (true);

drop policy if exists "Admins manage headquarters" on public.headquarters;
create policy "Admins manage headquarters"
on public.headquarters
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.user_role() = 'admin');

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
on public.profiles
for update
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

drop policy if exists "Inventory readable by authenticated users" on public.inventory_items;
create policy "Inventory readable by authenticated users"
on public.inventory_items
for select
to authenticated
using (
  public.user_role() = 'admin'
  or headquarters_id = public.user_headquarters_id()
);

drop policy if exists "Operators and admins manage inventory" on public.inventory_items;
drop policy if exists "Admins and editors manage inventory" on public.inventory_items;
create policy "Admins and editors manage inventory"
on public.inventory_items
for all
to authenticated
using (
  public.user_role() = 'admin'
  or (
    public.user_role() in ('editor', 'operator')
    and headquarters_id = public.user_headquarters_id()
  )
)
with check (
  public.user_role() = 'admin'
  or (
    public.user_role() in ('editor', 'operator')
    and headquarters_id = public.user_headquarters_id()
  )
);

drop policy if exists "Locations readable by authenticated users" on public.locations;
create policy "Locations readable by authenticated users"
on public.locations
for select
to authenticated
using (
  public.user_role() = 'admin'
  or headquarters_id = public.user_headquarters_id()
);

drop policy if exists "Admins and operators manage locations" on public.locations;
drop policy if exists "Admins and editors manage locations" on public.locations;
drop policy if exists "Admins manage locations" on public.locations;
create policy "Admins manage locations"
on public.locations
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

drop policy if exists "Categories readable by authenticated users" on public.inventory_categories;
create policy "Categories readable by authenticated users"
on public.inventory_categories
for select
to authenticated
using (true);

drop policy if exists "Admins manage categories" on public.inventory_categories;
create policy "Admins manage categories"
on public.inventory_categories
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

drop policy if exists "Templates readable by authenticated users" on public.inventory_templates;
create policy "Templates readable by authenticated users"
on public.inventory_templates
for select
to authenticated
using (true);

drop policy if exists "Admins manage templates" on public.inventory_templates;
create policy "Admins manage templates"
on public.inventory_templates
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

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

drop policy if exists "Template fields readable by authenticated users" on public.inventory_template_fields;
create policy "Template fields readable by authenticated users"
on public.inventory_template_fields
for select
to authenticated
using (true);

drop policy if exists "Admins manage template fields" on public.inventory_template_fields;
create policy "Admins manage template fields"
on public.inventory_template_fields
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

drop policy if exists "Relations readable by authenticated users" on public.inventory_item_relations;
create policy "Relations readable by authenticated users"
on public.inventory_item_relations
for select
to authenticated
using (
  public.user_role() = 'admin'
  or exists (
    select 1
    from public.inventory_items i
    where i.id = source_item_id
      and i.headquarters_id = public.user_headquarters_id()
  )
);

drop policy if exists "Admins and operators manage relations" on public.inventory_item_relations;
drop policy if exists "Admins and editors manage relations" on public.inventory_item_relations;
create policy "Admins and editors manage relations"
on public.inventory_item_relations
for all
to authenticated
using (
  public.user_role() = 'admin'
  or (
    public.user_role() in ('editor', 'operator')
    and exists (
      select 1
      from public.inventory_items i
      where i.id = source_item_id
        and i.headquarters_id = public.user_headquarters_id()
    )
  )
)
with check (
  public.user_role() = 'admin'
  or (
    public.user_role() in ('editor', 'operator')
    and exists (
      select 1
      from public.inventory_items i
      where i.id = source_item_id
        and i.headquarters_id = public.user_headquarters_id()
    )
  )
);

drop policy if exists "Containers readable by authenticated users" on public.inventory_containers;
create policy "Containers readable by authenticated users"
on public.inventory_containers
for select
to authenticated
using (
  public.user_role() = 'admin'
  or headquarters_id = public.user_headquarters_id()
);

drop policy if exists "Admins and editors manage containers" on public.inventory_containers;
drop policy if exists "Admins manage containers" on public.inventory_containers;
create policy "Admins manage containers"
on public.inventory_containers
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

drop policy if exists "Container items readable by authenticated users" on public.inventory_container_items;
create policy "Container items readable by authenticated users"
on public.inventory_container_items
for select
to authenticated
using (
  public.user_role() = 'admin'
  or exists (
    select 1
    from public.inventory_containers c
    where c.id = container_id
      and c.headquarters_id = public.user_headquarters_id()
  )
);

drop policy if exists "Admins and editors manage container items" on public.inventory_container_items;
create policy "Admins and editors manage container items"
on public.inventory_container_items
for all
to authenticated
using (
  public.user_role() = 'admin'
  or (
    public.user_role() in ('editor', 'operator')
    and exists (
      select 1
      from public.inventory_containers c
      where c.id = container_id
        and c.headquarters_id = public.user_headquarters_id()
    )
  )
)
with check (
  public.user_role() = 'admin'
  or (
    public.user_role() in ('editor', 'operator')
    and exists (
      select 1
      from public.inventory_containers c
      where c.id = container_id
        and c.headquarters_id = public.user_headquarters_id()
    )
  )
);

drop policy if exists "Movements readable by authenticated users" on public.inventory_movements;
create policy "Movements readable by authenticated users"
on public.inventory_movements
for select
to authenticated
using (
  public.user_role() = 'admin'
  or exists (
    select 1
    from public.inventory_items i
    where i.id = item_id
      and i.headquarters_id = public.user_headquarters_id()
  )
);

drop policy if exists "Operators and admins manage movements" on public.inventory_movements;
drop policy if exists "Admins and editors manage movements" on public.inventory_movements;
create policy "Admins and editors manage movements"
on public.inventory_movements
for all
to authenticated
using (
  public.user_role() = 'admin'
  or (
    public.user_role() in ('editor', 'operator')
    and exists (
      select 1
      from public.inventory_items i
      where i.id = item_id
        and i.headquarters_id = public.user_headquarters_id()
    )
  )
)
with check (
  public.user_role() = 'admin'
  or (
    public.user_role() in ('editor', 'operator')
    and exists (
      select 1
      from public.inventory_items i
      where i.id = item_id
        and i.headquarters_id = public.user_headquarters_id()
    )
  )
);

drop policy if exists "Alerts readable by authenticated users" on public.alerts;
create policy "Alerts readable by authenticated users"
on public.alerts
for select
to authenticated
using (
  public.user_role() = 'admin'
  or exists (
    select 1
    from public.inventory_items i
    where i.id = item_id
      and i.headquarters_id = public.user_headquarters_id()
  )
);

drop policy if exists "Admins and operators manage alerts" on public.alerts;
drop policy if exists "Admins and editors manage alerts" on public.alerts;
create policy "Admins and editors manage alerts"
on public.alerts
for all
to authenticated
using (
  public.user_role() = 'admin'
  or (
    public.user_role() in ('editor', 'operator')
    and exists (
      select 1
      from public.inventory_items i
      where i.id = item_id
        and i.headquarters_id = public.user_headquarters_id()
    )
  )
)
with check (
  public.user_role() = 'admin'
  or (
    public.user_role() in ('editor', 'operator')
    and exists (
      select 1
      from public.inventory_items i
      where i.id = item_id
        and i.headquarters_id = public.user_headquarters_id()
    )
  )
);

create unique index if not exists alerts_item_type_date_unique
on public.alerts (item_id, alert_type, trigger_date);

drop trigger if exists set_notification_preferences_updated_at on public.notification_preferences;
create trigger set_notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

drop policy if exists "Users can read their own notification preferences" on public.notification_preferences;
create policy "Users can read their own notification preferences"
on public.notification_preferences
for select
to authenticated
using (profile_id = auth.uid() or public.user_role() = 'admin');

drop policy if exists "Users can manage their own notification preferences" on public.notification_preferences;
drop policy if exists "Admins manage notification preferences" on public.notification_preferences;
create policy "Admins manage notification preferences"
on public.notification_preferences
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

drop policy if exists "Users can read their own notification events" on public.notification_events;
create policy "Users can read their own notification events"
on public.notification_events
for select
to authenticated
using (profile_id = auth.uid() or public.user_role() = 'admin');
