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

drop trigger if exists set_headquarters_updated_at on public.headquarters;
create trigger set_headquarters_updated_at
before update on public.headquarters
for each row execute function public.set_updated_at();

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

alter table public.profiles
  add column if not exists headquarters_id uuid references public.headquarters (id);

alter table public.inventory_items
  add column if not exists headquarters_id uuid references public.headquarters (id);

create index if not exists profiles_headquarters_id_idx
on public.profiles (headquarters_id);

create index if not exists inventory_items_headquarters_id_idx
on public.inventory_items (headquarters_id);

insert into public.app_roles (code, name, description)
values
  ('admin', 'Administrador', 'Control total de usuarios, sedes y catálogo.'),
  ('editor', 'Editor', 'Crea y actualiza inventario de su sede.'),
  ('reader', 'Lector', 'Consulta el inventario de su sede.')
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description;

update public.profiles p
set role_id = new_role.id
from public.app_roles old_role, public.app_roles new_role
where p.role_id = old_role.id
  and old_role.code = 'operator'
  and new_role.code = 'editor';

update public.profiles p
set role_id = new_role.id
from public.app_roles old_role, public.app_roles new_role
where p.role_id = old_role.id
  and old_role.code = 'viewer'
  and new_role.code = 'reader';

update public.profiles p
set headquarters_id = h.id
from public.app_roles ar, public.headquarters h
where p.role_id = ar.id
  and ar.code <> 'admin'
  and p.headquarters_id is null
  and h.slug = 'valencia';

update public.inventory_items i
set headquarters_id = h.id
from public.headquarters h
where i.headquarters_id is null
  and h.slug = 'valencia';

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

  if default_role_id is null then
    select id into default_role_id
    from public.app_roles
    where code = 'viewer';
  end if;

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

alter table public.headquarters enable row level security;

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
