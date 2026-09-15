alter table public.locations
  add column if not exists headquarters_id uuid references public.headquarters (id),
  add column if not exists parent_location_id uuid references public.locations (id),
  add column if not exists code text,
  add column if not exists location_type text not null default 'storage' check (location_type in ('room', 'cabinet', 'shelf', 'rack', 'vehicle', 'storage', 'other')),
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists locations_headquarters_id_idx
on public.locations (headquarters_id);

update public.locations l
set headquarters_id = h.id
from public.headquarters h
where l.headquarters_id is null
  and h.slug = 'valencia';

drop trigger if exists set_locations_updated_at on public.locations;
create trigger set_locations_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

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

create index if not exists inventory_containers_headquarters_id_idx
on public.inventory_containers (headquarters_id);

create index if not exists inventory_containers_location_id_idx
on public.inventory_containers (location_id);

drop trigger if exists set_inventory_containers_updated_at on public.inventory_containers;
create trigger set_inventory_containers_updated_at
before update on public.inventory_containers
for each row execute function public.set_updated_at();

create table if not exists public.inventory_container_items (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.inventory_containers (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (container_id, item_id)
);

alter table public.inventory_containers enable row level security;
alter table public.inventory_container_items enable row level security;

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
create policy "Admins and editors manage locations"
on public.locations
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
create policy "Admins and editors manage containers"
on public.inventory_containers
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
