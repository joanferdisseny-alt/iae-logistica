begin;

create or replace function public.user_role() returns text
language sql stable security definer set search_path = public
as $$ select r.code from public.profiles p join public.app_roles r on r.id = p.role_id
where p.id = auth.uid() and p.is_active $$;

create or replace function public.user_headquarters_id() returns uuid
language sql stable security definer set search_path = public
as $$ select p.headquarters_id from public.profiles p where p.id = auth.uid() and p.is_active $$;

revoke all on function public.user_role() from public;
revoke all on function public.user_headquarters_id() from public;
grant execute on function public.user_role(), public.user_headquarters_id() to authenticated;

alter table public.profiles add column if not exists is_logistics_contact boolean not null default false;
alter table public.inventory_items add column if not exists operational_status text not null default 'available'
  check (operational_status in ('available', 'in_use', 'repair', 'inspection', 'retired'));
-- Legacy maintenance records must not become available during the upgrade.
update public.inventory_items set operational_status='inspection'
where status='maintenance' and operational_status='available';
alter table public.inventory_items add column if not exists lot_code text;
alter table public.inventory_items alter column current_stock type numeric(14,3);
alter table public.inventory_items alter column minimum_stock type numeric(14,3);
alter table public.inventory_movements alter column quantity type numeric(14,3);
alter table public.inventory_container_items alter column quantity type numeric(14,3);
alter table public.inventory_movements add column if not exists balance_after numeric(14,3);
alter table public.inventory_movements add column if not exists request_id uuid;
create unique index if not exists inventory_movement_request_idx on public.inventory_movements(request_id);
alter table public.inventory_items drop constraint if exists inventory_stock_nonnegative;
alter table public.inventory_items add constraint inventory_stock_nonnegative check (current_stock >= 0 and (minimum_stock is null or minimum_stock >= 0)) not valid;

create table if not exists public.inventory_item_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  actor_id uuid references public.profiles(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists item_history_item_idx on public.inventory_item_history(item_id,created_at desc);
create table if not exists public.inventory_attachments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  title text not null,
  url text not null check (url ~ '^https://'),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.inventory_item_history enable row level security;
alter table public.inventory_attachments enable row level security;
drop policy if exists "Read visible history" on public.inventory_item_history;
create policy "Read visible history" on public.inventory_item_history for select to authenticated
using (exists (select 1 from public.inventory_items i where i.id=item_id));
drop policy if exists "Read visible attachments" on public.inventory_attachments;
create policy "Read visible attachments" on public.inventory_attachments for select to authenticated
using (exists (select 1 from public.inventory_items i where i.id=item_id));
drop policy if exists "Admins manage attachments" on public.inventory_attachments;
create policy "Admins manage attachments" on public.inventory_attachments for all to authenticated
using (public.user_role()='admin') with check (public.user_role()='admin');

-- Editors can create their own site's records, but cannot change existing resources.
drop policy if exists "Admins and editors manage inventory" on public.inventory_items;
drop policy if exists "Operators and admins manage inventory" on public.inventory_items;
drop policy if exists "Admins manage inventory" on public.inventory_items;
create policy "Admins manage inventory" on public.inventory_items for all to authenticated
using (public.user_role()='admin') with check (public.user_role()='admin');
drop policy if exists "Editors create inventory" on public.inventory_items;
create policy "Editors create inventory" on public.inventory_items for insert to authenticated
with check (public.user_role() in ('editor','operator') and headquarters_id=public.user_headquarters_id() and created_by=auth.uid());

drop policy if exists "Admins and editors manage movements" on public.inventory_movements;
drop policy if exists "Operators and admins manage movements" on public.inventory_movements;
drop policy if exists "Admins and editors manage relations" on public.inventory_item_relations;
drop policy if exists "Admins and operators manage relations" on public.inventory_item_relations;
drop policy if exists "Admins manage relations" on public.inventory_item_relations;
create policy "Admins manage relations" on public.inventory_item_relations for all to authenticated
using (public.user_role()='admin') with check (public.user_role()='admin');
drop policy if exists "Admins and editors manage container items" on public.inventory_container_items;
drop policy if exists "Admins manage container items" on public.inventory_container_items;
create policy "Admins manage container items" on public.inventory_container_items for all to authenticated
using (public.user_role()='admin') with check (public.user_role()='admin');
drop policy if exists "Admins and editors manage alerts" on public.alerts;
drop policy if exists "Admins and operators manage alerts" on public.alerts;
drop policy if exists "Admins manage alerts" on public.alerts;
create policy "Admins manage alerts" on public.alerts for all to authenticated
using (public.user_role()='admin') with check (public.user_role()='admin');

drop policy if exists "Headquarters readable by authenticated users" on public.headquarters;
create policy "Headquarters readable by authenticated users" on public.headquarters for select to authenticated
using (public.user_role()='admin' or id=public.user_headquarters_id());
drop policy if exists "Inventory readable by authenticated users" on public.inventory_items;
create policy "Inventory readable by authenticated users" on public.inventory_items for select to authenticated
using (public.user_role()='admin' or (public.user_role() is not null and headquarters_id=public.user_headquarters_id()));

create or replace function public.guard_inventory_integrity() returns trigger
language plpgsql security definer set search_path = public as $$
declare h uuid; other_h uuid; q numeric;
begin
  -- Serializes hierarchy/placement changes and prevents check/write races.
  perform pg_advisory_xact_lock(90714001);
  if tg_table_name='locations' then
    if new.headquarters_id is null then raise exception 'La ubicacion necesita sede'; end if;
    if new.parent_location_id is not null then
      select headquarters_id into h from public.locations where id=new.parent_location_id;
      if h is distinct from new.headquarters_id then raise exception 'La ubicacion padre debe ser de la misma sede'; end if;
      if exists (with recursive ancestors as (
        select id,parent_location_id from public.locations where id=new.parent_location_id
        union select l.id,l.parent_location_id from public.locations l join ancestors a on l.id=a.parent_location_id
      ) select 1 from ancestors where id=new.id) then raise exception 'La jerarquia de ubicaciones contiene un ciclo'; end if;
    end if;
    if tg_op='UPDATE' and old.headquarters_id is distinct from new.headquarters_id and (
      exists(select 1 from public.inventory_items where location_id=new.id) or
      exists(select 1 from public.inventory_containers where location_id=new.id) or
      exists(select 1 from public.locations where parent_location_id=new.id)
    ) then raise exception 'Mueve el contenido antes de cambiar la sede'; end if;
  elsif tg_table_name='inventory_containers' then
    if new.location_id is not null then
      select headquarters_id into h from public.locations where id=new.location_id;
      if h is distinct from new.headquarters_id then raise exception 'La caja y su ubicacion deben pertenecer a la misma sede'; end if;
    end if;
    if tg_op='UPDATE' and old.headquarters_id is distinct from new.headquarters_id and exists(
      select 1 from public.inventory_container_items where container_id=new.id
    ) then raise exception 'Vacia la caja antes de cambiar su sede'; end if;
  elsif tg_table_name='inventory_items' then
    if new.headquarters_id is null then raise exception 'El articulo necesita sede'; end if;
    if new.location_id is not null then
      select headquarters_id into h from public.locations where id=new.location_id;
      if h is distinct from new.headquarters_id then raise exception 'Articulo y ubicacion deben ser de la misma sede'; end if;
      if exists(select 1 from public.inventory_container_items where item_id=new.id) then raise exception 'El articulo ya esta en una caja'; end if;
    end if;
    if exists(select 1 from public.inventory_container_items ci join public.inventory_containers c on c.id=ci.container_id
      where ci.item_id=new.id and c.headquarters_id is distinct from new.headquarters_id) then raise exception 'La caja pertenece a otra sede'; end if;
  elsif tg_table_name='inventory_container_items' then
    select headquarters_id,current_stock into h,q from public.inventory_items where id=new.item_id for update;
    select headquarters_id into other_h from public.inventory_containers where id=new.container_id;
    if h is null or h is distinct from other_h then raise exception 'Caja y articulo deben pertenecer a la misma sede'; end if;
    if exists(select 1 from public.inventory_items where id=new.item_id and location_id is not null) then raise exception 'El articulo tiene ubicacion directa'; end if;
    if new.quantity <> q then raise exception 'La cantidad de la caja debe ser el stock completo de esta partida'; end if;
  elsif tg_table_name='inventory_item_relations' then
    select headquarters_id into h from public.inventory_items where id=new.source_item_id;
    select headquarters_id into other_h from public.inventory_items where id=new.target_item_id;
    if new.source_item_id=new.target_item_id or h is null or h is distinct from other_h then raise exception 'Relacion invalida o entre sedes diferentes'; end if;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['locations','inventory_containers','inventory_items','inventory_container_items','inventory_item_relations'] loop
    execute format('drop trigger if exists guard_inventory_integrity on public.%I',t);
    execute format('create trigger guard_inventory_integrity before insert or update on public.%I for each row execute function public.guard_inventory_integrity()',t);
  end loop;
end $$;

create or replace function public.place_inventory_item(p_item_id uuid,p_type text,p_location_id uuid default null,p_container_id uuid default null,p_quantity numeric default 1,p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare i public.inventory_items; previous jsonb;
begin
  if public.user_role() <> 'admin' or public.user_role() is null then raise exception 'Solo administradores pueden reubicar articulos'; end if;
  perform pg_advisory_xact_lock(90714001);
  select * into i from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'Articulo no encontrado'; end if;
  if p_type not in ('none','location','container') or p_type is null then raise exception 'Destino invalido'; end if;
  if p_type='location' and not exists(select 1 from public.locations where id=p_location_id and headquarters_id=i.headquarters_id and is_active) then raise exception 'Ubicacion no valida para esta sede'; end if;
  if p_type='container' then
    if not exists(select 1 from public.inventory_containers where id=p_container_id and headquarters_id=i.headquarters_id and is_active) then raise exception 'Caja no valida para esta sede'; end if;
    if p_quantity is null or p_quantity<=0 or p_quantity<>i.current_stock then raise exception 'Mueve la partida completa; para repartirla crea partidas separadas'; end if;
  end if;
  previous=jsonb_build_object('location_id',i.location_id,'container_id',(select container_id from public.inventory_container_items where item_id=i.id));
  delete from public.inventory_container_items where item_id=i.id;
  update public.inventory_items set location_id=case when p_type='location' then p_location_id else null end where id=i.id;
  if p_type='container' then insert into public.inventory_container_items(container_id,item_id,quantity,notes) values(p_container_id,i.id,p_quantity,p_notes); end if;
  insert into public.inventory_item_history(item_id,actor_id,event_type,details) values(i.id,auth.uid(),'placement',jsonb_build_object('before',previous,'type',p_type,'location_id',p_location_id,'container_id',p_container_id,'notes',p_notes));
end $$;

create or replace function public.record_inventory_movement(p_item_id uuid,p_type text,p_quantity numeric,p_notes text,p_request_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare i public.inventory_items; balance numeric; previous public.inventory_movements;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administradores pueden registrar movimientos'; end if;
  if p_request_id is null then raise exception 'Falta el identificador de movimiento'; end if;
  perform pg_advisory_xact_lock(90714001);
  select * into previous from public.inventory_movements where request_id=p_request_id;
  if found then
    if previous.item_id<>p_item_id or previous.movement_type<>p_type or previous.quantity<>p_quantity or previous.notes is distinct from p_notes then raise exception 'Identificador reutilizado con datos distintos'; end if;
    return previous.balance_after;
  end if;
  select * into i from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'Articulo no encontrado'; end if;
  if p_type is null or p_type not in ('in','out','adjustment') or p_quantity is null or p_quantity<0 or p_quantity<>round(p_quantity,3) or (p_type<>'adjustment' and p_quantity=0) then raise exception 'Cantidad o movimiento invalido'; end if;
  if length(trim(coalesce(p_notes,'')))<3 then raise exception 'Indica el motivo del movimiento'; end if;
  balance=case p_type when 'in' then i.current_stock+p_quantity when 'out' then i.current_stock-p_quantity else p_quantity end;
  if balance<0 then raise exception 'Stock insuficiente'; end if;
  update public.inventory_items set current_stock=balance,
    status=case when expiration_date<current_date then 'expired' when minimum_stock is not null and balance<=minimum_stock then 'low' else 'ok' end where id=i.id;
  if balance=0 then delete from public.inventory_container_items where item_id=i.id;
  else update public.inventory_container_items set quantity=balance where item_id=i.id; end if;
  insert into public.inventory_movements(item_id,movement_type,quantity,notes,created_by,balance_after,request_id)
    values(i.id,p_type,p_quantity,p_notes,auth.uid(),balance,p_request_id);
  return balance;
end $$;

create or replace function public.update_inventory_item(p_item_id uuid,p_name text,p_description text,p_status text,p_maintenance_due_at date,p_expiration_date date,p_minimum_stock numeric,p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare i public.inventory_items;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administradores pueden editar articulos'; end if;
  perform pg_advisory_xact_lock(90714001);
  select * into i from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'Articulo no encontrado'; end if;
  if length(trim(coalesce(p_name,'')))<2 or p_status is null or p_status not in ('available','in_use','repair','inspection','retired') or p_minimum_stock<0 or length(trim(coalesce(p_notes,'')))<3 then raise exception 'Revisa nombre, estado, stock minimo y motivo'; end if;
  update public.inventory_items set name=trim(p_name),description=p_description,operational_status=p_status,
    maintenance_due_at=p_maintenance_due_at,expiration_date=p_expiration_date,minimum_stock=p_minimum_stock,
    status=case when p_expiration_date<current_date then 'expired' when p_minimum_stock is not null and current_stock<=p_minimum_stock then 'low' else 'ok' end where id=i.id;
  insert into public.inventory_item_history(item_id,actor_id,event_type,details) values(i.id,auth.uid(),'update',jsonb_build_object('before',to_jsonb(i),'status',p_status,'notes',p_notes));
end $$;

-- New records and initial placement are committed together, including editor creation.
create or replace function public.create_inventory_record(p_record jsonb,p_container_id uuid default null,p_quantity numeric default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; h uuid; r text; stock numeric;
begin
  r=public.user_role(); h=(p_record->>'headquarters_id')::uuid;
  if r is null or r not in ('admin','editor','operator') or (r<>'admin' and h is distinct from public.user_headquarters_id()) then raise exception 'No tienes permiso para crear en esta sede'; end if;
  if not exists(select 1 from public.headquarters where id=h and is_active) then raise exception 'Sede no disponible'; end if;
  perform pg_advisory_xact_lock(90714001);
  stock=coalesce((p_record->>'current_stock')::numeric,0);
  if stock<0 then raise exception 'Stock invalido'; end if;
  insert into public.inventory_items(name,slug,template_id,category,subtype,description,technical_specs,sku,serial_number,headquarters_id,location_id,is_consumable,minimum_stock,current_stock,unit,expiration_date,maintenance_due_at,status,created_by,lot_code)
  select p_record->>'name',p_record->>'slug',t.id,t.category_code,p_record->>'subtype',p_record->>'description',coalesce(p_record->'technical_specs','{}'::jsonb),p_record->>'sku',p_record->>'serial_number',h,(p_record->>'location_id')::uuid,coalesce((p_record->>'is_consumable')::boolean,false),(p_record->>'minimum_stock')::numeric,stock,p_record->>'unit',(p_record->>'expiration_date')::date,(p_record->>'maintenance_due_at')::date,
    case when (p_record->>'expiration_date')::date<current_date then 'expired' when stock<=(p_record->>'minimum_stock')::numeric then 'low' else 'ok' end,auth.uid(),p_record->>'lot_code'
  from public.inventory_templates t where t.id=(p_record->>'template_id')::uuid returning id into new_id;
  if new_id is null then raise exception 'Plantilla no encontrada'; end if;
  if p_container_id is not null then
    if not exists(select 1 from public.inventory_containers where id=p_container_id and headquarters_id=h and is_active) then raise exception 'Caja no disponible en esta sede'; end if;
    insert into public.inventory_container_items(container_id,item_id,quantity,notes) values(p_container_id,new_id,stock,p_notes);
  end if;
  insert into public.inventory_item_history(item_id,actor_id,event_type,details) values(new_id,auth.uid(),'created',jsonb_build_object('stock',stock));
  return new_id;
end $$;

create or replace function public.protect_last_admin() returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(90714002);
  if old.is_active and exists(select 1 from public.app_roles where id=old.role_id and code='admin') and
    (not new.is_active or new.role_id<>old.role_id) and not exists(
      select 1 from public.profiles p join public.app_roles r on r.id=p.role_id where p.id<>old.id and p.is_active and r.code='admin'
    ) then raise exception 'No puedes desactivar o cambiar el rol del ultimo administrador'; end if;
  return new;
end $$;
drop trigger if exists protect_last_admin on public.profiles;
create trigger protect_last_admin before update on public.profiles for each row execute function public.protect_last_admin();

-- Technical keys are stable identifiers; labels remain editable.
create or replace function public.protect_field_key() returns trigger language plpgsql as $$
begin
  if (new.field_key<>old.field_key or new.field_type<>old.field_type) and exists(select 1 from public.inventory_template_fields where field_id=old.id) then
    raise exception 'Un campo asignado no puede cambiar de clave o tipo. Crea otro campo y conserva el historial';
  end if;
  return new;
end $$;
drop trigger if exists protect_field_key on public.inventory_fields;
create trigger protect_field_key before update on public.inventory_fields for each row execute function public.protect_field_key();

revoke all on function public.place_inventory_item(uuid,text,uuid,uuid,numeric,text) from public;
revoke all on function public.record_inventory_movement(uuid,text,numeric,text,uuid) from public;
revoke all on function public.update_inventory_item(uuid,text,text,text,date,date,numeric,text) from public;
revoke all on function public.create_inventory_record(jsonb,uuid,numeric,text) from public;
grant execute on function public.place_inventory_item(uuid,text,uuid,uuid,numeric,text), public.record_inventory_movement(uuid,text,numeric,text,uuid), public.update_inventory_item(uuid,text,text,text,date,date,numeric,text), public.create_inventory_record(jsonb,uuid,numeric,text) to authenticated;
grant select on public.inventory_item_history,public.inventory_attachments to authenticated;
grant insert,update,delete on public.inventory_attachments to authenticated;

commit;
