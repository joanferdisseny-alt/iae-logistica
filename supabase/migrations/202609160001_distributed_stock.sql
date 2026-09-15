begin;

-- Keep the old item and box totals as read-only projections for existing screens.
create table public.inventory_stock_lots (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  code text not null check(length(trim(code)) between 1 and 120),
  expiration_date date,
  created_at timestamptz not null default now(),
  unique(item_id,code), unique(id,item_id)
);
create table public.inventory_stock_positions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  lot_id uuid not null,
  location_id uuid references public.locations(id) on delete restrict,
  container_id uuid references public.inventory_containers(id) on delete restrict,
  notes text not null default '',
  quantity numeric not null check(quantity>=0 and quantity<=99999999999.999 and quantity=round(quantity,3)),
  foreign key(lot_id,item_id) references public.inventory_stock_lots(id,item_id),
  check(location_id is null or container_id is null),
  unique nulls not distinct(lot_id,location_id,container_id)
);
create index stock_positions_item on public.inventory_stock_positions(item_id);
create index stock_positions_box on public.inventory_stock_positions(container_id);
create index stock_positions_location on public.inventory_stock_positions(location_id);
create table public.inventory_stock_events (
  request_id uuid primary key,
  item_id uuid not null references public.inventory_items(id),
  actor_id uuid not null references public.profiles(id),
  payload jsonb not null,
  balance_after numeric not null,
  created_at timestamptz not null default now()
);

do $$ begin
  if exists(select 1 from public.inventory_container_items c join public.inventory_items i on i.id=c.item_id
    where c.quantity<>i.current_stock or i.location_id is not null) then
    raise exception 'Hay asignaciones antiguas inconsistentes. Revisa cajas y cantidades antes de migrar';
  end if;
  if exists(select 1 from public.inventory_items where nullif(trim(serial_number),'') is not null and current_stock not in (0,1)) then
    raise exception 'Una herramienta con numero de serie tiene una cantidad distinta de 0 o 1. Corrige su stock antes de migrar';
  end if;
end $$;
insert into public.inventory_stock_lots(item_id,code,expiration_date)
select id,coalesce(nullif(trim(lot_code),''),'Inicial'),expiration_date from public.inventory_items;
insert into public.inventory_stock_positions(item_id,lot_id,location_id,container_id,quantity,notes)
select i.id,l.id,i.location_id,c.container_id,i.current_stock,coalesce(c.notes,'') from public.inventory_items i
join public.inventory_stock_lots l on l.item_id=i.id
left join public.inventory_container_items c on c.item_id=i.id;
drop index if exists public.inventory_container_items_one_container_per_item_idx;

alter table public.inventory_stock_lots enable row level security;
alter table public.inventory_stock_positions enable row level security;
alter table public.inventory_stock_events enable row level security;
create policy stock_lots_read on public.inventory_stock_lots for select to authenticated
using(exists(select 1 from public.inventory_items i where i.id=item_id));
create policy stock_positions_read on public.inventory_stock_positions for select to authenticated
using(exists(select 1 from public.inventory_items i where i.id=item_id));
create policy stock_events_read on public.inventory_stock_events for select to authenticated
using(exists(select 1 from public.inventory_items i where i.id=item_id));
revoke all on public.inventory_stock_lots,public.inventory_stock_positions,public.inventory_stock_events from public,anon,authenticated;
grant select on public.inventory_stock_lots,public.inventory_stock_positions,public.inventory_stock_events to authenticated;
revoke insert,update,delete on public.inventory_items,public.inventory_container_items from public,anon,authenticated;

create or replace function public.guard_inventory_integrity() returns trigger
language plpgsql security definer set search_path='' as $$
declare h uuid; other_h uuid;
begin
  perform pg_advisory_xact_lock(90714001);
  if tg_table_name='locations' then
    if new.headquarters_id is null then raise exception 'La ubicacion necesita sede'; end if;
    if new.parent_location_id is not null then
      select headquarters_id into h from public.locations where id=new.parent_location_id;
      if h is distinct from new.headquarters_id then raise exception 'La ubicacion padre debe ser de la misma sede'; end if;
      if exists(with recursive ancestors as (
        select id,parent_location_id from public.locations where id=new.parent_location_id
        union select l.id,l.parent_location_id from public.locations l join ancestors a on l.id=a.parent_location_id
      ) select 1 from ancestors where id=new.id) then raise exception 'La jerarquia de ubicaciones contiene un ciclo'; end if;
    end if;
    if tg_op='UPDATE' and old.headquarters_id is distinct from new.headquarters_id and (
      exists(select 1 from public.inventory_stock_positions where location_id=new.id) or
      exists(select 1 from public.inventory_containers where location_id=new.id) or
      exists(select 1 from public.locations where parent_location_id=new.id)
    ) then raise exception 'La ubicacion tiene existencias o historial asociado'; end if;
  elsif tg_table_name='inventory_containers' then
    if new.location_id is not null then
      select headquarters_id into h from public.locations where id=new.location_id;
      if h is distinct from new.headquarters_id then raise exception 'La caja y su ubicacion deben pertenecer a la misma sede'; end if;
    end if;
    if tg_op='UPDATE' and old.headquarters_id is distinct from new.headquarters_id and
      exists(select 1 from public.inventory_stock_positions where container_id=new.id) then raise exception 'La caja tiene existencias o historial asociado'; end if;
  elsif tg_table_name='inventory_items' then
    if new.headquarters_id is null then raise exception 'El articulo necesita sede'; end if;
    if new.location_id is not null then
      select headquarters_id into h from public.locations where id=new.location_id;
      if h is distinct from new.headquarters_id then raise exception 'Articulo y ubicacion deben ser de la misma sede'; end if;
    end if;
    if tg_op='UPDATE' and old.headquarters_id is distinct from new.headquarters_id and
      exists(select 1 from public.inventory_stock_lots where item_id=new.id) then raise exception 'El inventario y su historial pertenecen a su sede'; end if;
    if nullif(trim(new.serial_number),'') is not null and new.current_stock not in (0,1) then raise exception 'Una herramienta identificada por serie admite 0 o 1 unidades'; end if;
  elsif tg_table_name='inventory_container_items' then
    select headquarters_id into h from public.inventory_items where id=new.item_id;
    select headquarters_id into other_h from public.inventory_containers where id=new.container_id;
    if h is null or h is distinct from other_h then raise exception 'Caja y articulo deben pertenecer a la misma sede'; end if;
  elsif tg_table_name='inventory_item_relations' then
    select headquarters_id into h from public.inventory_items where id=new.source_item_id;
    select headquarters_id into other_h from public.inventory_items where id=new.target_item_id;
    if new.source_item_id=new.target_item_id or h is null or h is distinct from other_h then raise exception 'Relacion invalida o entre sedes diferentes'; end if;
  end if;
  return new;
end $$;

create function public.sync_inventory_stock(p_item_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare total numeric; direct uuid; expiry date;
begin
  select coalesce(sum(quantity),0) into total from public.inventory_stock_positions where item_id=p_item_id;
  if (select count(*) from public.inventory_stock_positions where item_id=p_item_id and quantity>0)=1 then
    select location_id into direct from public.inventory_stock_positions where item_id=p_item_id and quantity>0;
  end if;
  select min(l.expiration_date) into expiry from public.inventory_stock_lots l
    where l.item_id=p_item_id and exists(select 1 from public.inventory_stock_positions s where s.lot_id=l.id and s.quantity>0);
  delete from public.inventory_container_items where item_id=p_item_id;
  update public.inventory_items set current_stock=total,location_id=direct,expiration_date=expiry,
    status=case when expiry<current_date then 'expired' when minimum_stock is not null and total<=minimum_stock then 'low' else 'ok' end where id=p_item_id;
  insert into public.inventory_container_items(item_id,container_id,quantity)
    select p_item_id,container_id,sum(quantity) from public.inventory_stock_positions
    where item_id=p_item_id and container_id is not null group by container_id having sum(quantity)>0;
end $$;

create function public.manage_inventory_stock(p_request_id uuid,p_item_id uuid,p_action text,p_source_id uuid,p_lot_id uuid,
  p_location_id uuid,p_container_id uuid,p_quantity numeric,p_notes text,p_lot_code text default null,p_expiration_date date default null,p_expected_quantity numeric default null)
returns numeric language plpgsql security definer set search_path='' as $$
declare i public.inventory_items; src public.inventory_stock_positions; dest uuid; lot uuid; total numeric; payload jsonb; previous public.inventory_stock_events; previous_lot jsonb;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede modificar existencias'; end if;
  if p_request_id is null or p_action is null or p_action not in ('in','out','adjustment','transfer','new_lot','edit_lot')
    or p_quantity is null or p_quantity<0 or p_quantity>99999999999.999 or p_quantity<>round(p_quantity,3)
    or (p_action in ('in','out','transfer') and p_quantity=0)
    or length(trim(coalesce(p_notes,''))) not between 3 and 2000 then raise exception 'Revisa operacion, cantidad y motivo'; end if;
  payload=jsonb_build_object('action',p_action,'source',p_source_id,'lot',p_lot_id,'location',p_location_id,'container',p_container_id,
    'quantity',p_quantity,'notes',p_notes,'code',p_lot_code,'expiry',p_expiration_date,'expected_quantity',p_expected_quantity);
  perform pg_advisory_xact_lock(90714001);
  select * into previous from public.inventory_stock_events where request_id=p_request_id;
  if found then
    if previous.item_id is distinct from p_item_id or previous.actor_id<>auth.uid() or previous.payload<>payload then raise exception 'Identificador reutilizado con datos distintos'; end if;
    return previous.balance_after;
  end if;
  select * into i from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'Articulo no encontrado'; end if;
  if p_location_id is not null and p_container_id is not null then raise exception 'Elige caja o ubicacion, no ambas'; end if;
  if p_action in ('in','transfer','new_lot') then
    if p_location_id is not null and not exists(select 1 from public.locations where id=p_location_id and headquarters_id=i.headquarters_id and is_active) then raise exception 'Ubicacion no disponible en esta sede'; end if;
    if p_container_id is not null and not exists(select 1 from public.inventory_containers where id=p_container_id and headquarters_id=i.headquarters_id and is_active) then raise exception 'Caja no disponible en esta sede'; end if;
    if not exists(select 1 from public.headquarters where id=i.headquarters_id and is_active) then raise exception 'Sede inactiva'; end if;
  end if;
  if p_action in ('transfer','out','adjustment') then
    select * into src from public.inventory_stock_positions where id=p_source_id and item_id=i.id for update;
    if not found then raise exception 'Existencia de origen no encontrada'; end if;
    if p_expected_quantity is not null and p_expected_quantity<>src.quantity then raise exception 'La cantidad de origen ha cambiado. Recarga antes de guardar'; end if;
    lot=src.lot_id;
    if p_action<>'adjustment' and p_quantity>src.quantity then raise exception 'Stock insuficiente en el origen'; end if;
  elsif p_action='new_lot' then
    if length(trim(coalesce(p_lot_code,''))) not between 1 and 120 then raise exception 'Indica el codigo del lote'; end if;
    insert into public.inventory_stock_lots(item_id,code,expiration_date) values(i.id,trim(p_lot_code),p_expiration_date) returning id into lot;
  else
    select id into lot from public.inventory_stock_lots where id=p_lot_id and item_id=i.id;
    if not found then raise exception 'Lote no encontrado para este articulo'; end if;
  end if;
  if p_action='edit_lot' then
    if length(trim(coalesce(p_lot_code,''))) not between 1 and 120 then raise exception 'Indica el codigo del lote'; end if;
    select to_jsonb(l) into previous_lot from public.inventory_stock_lots l where id=lot;
    update public.inventory_stock_lots set code=trim(p_lot_code),expiration_date=p_expiration_date where id=lot;
  else
    if p_action in ('in','transfer','new_lot') then
      if p_action='transfer' and src.location_id is not distinct from p_location_id and src.container_id is not distinct from p_container_id then raise exception 'Origen y destino son iguales'; end if;
      insert into public.inventory_stock_positions(item_id,lot_id,location_id,container_id,quantity)
        values(i.id,lot,p_location_id,p_container_id,0) on conflict(lot_id,location_id,container_id) do nothing;
      select id into dest from public.inventory_stock_positions where lot_id=lot and location_id is not distinct from p_location_id and container_id is not distinct from p_container_id;
      update public.inventory_stock_positions set quantity=quantity+p_quantity where id=dest;
    end if;
    if p_action in ('out','transfer','adjustment') then
      update public.inventory_stock_positions set quantity=case when p_action='adjustment' then p_quantity else quantity-p_quantity end where id=src.id;
    end if;
  end if;
  if nullif(trim(i.serial_number),'') is not null and exists(select 1 from public.inventory_stock_positions
    where item_id=i.id and quantity not in (0,1)) then raise exception 'No puedes dividir una herramienta identificada por serie'; end if;
  perform public.sync_inventory_stock(i.id);
  select current_stock into total from public.inventory_items where id=i.id;
  insert into public.inventory_stock_events(request_id,item_id,actor_id,payload,balance_after) values(p_request_id,i.id,auth.uid(),payload,total);
  insert into public.inventory_item_history(item_id,actor_id,event_type,details)
    values(i.id,auth.uid(),'stock_'||p_action,payload||jsonb_build_object('lot_id',lot,'lot_before',previous_lot,'destination_id',dest,'source_before',to_jsonb(src),'balance_after',total,'request_id',p_request_id));
  if p_action in ('in','out','adjustment','new_lot') then
    insert into public.inventory_movements(item_id,movement_type,quantity,notes,created_by,balance_after,request_id)
      values(i.id,case when p_action='new_lot' then 'in' else p_action end,p_quantity,p_notes,auth.uid(),total,p_request_id);
  end if;
  return total;
end $$;

-- Old clients cannot overwrite a distribution by moving or recounting its total.
create or replace function public.place_inventory_item(p_item_id uuid,p_type text,p_location_id uuid default null,p_container_id uuid default null,p_quantity numeric default 1,p_notes text default null)
returns void language plpgsql security definer set search_path='' as $$
begin raise exception 'Usa Existencias y ubicaciones para trasladar cantidades desde un origen concreto'; end $$;
create or replace function public.record_inventory_movement(p_item_id uuid,p_type text,p_quantity numeric,p_notes text,p_request_id uuid)
returns numeric language plpgsql security definer set search_path='' as $$
declare s public.inventory_stock_positions;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede modificar existencias'; end if;
  perform pg_advisory_xact_lock(90714001);
  if (select count(*) from public.inventory_stock_positions where item_id=p_item_id)<>1 then raise exception 'Elige el lote y la ubicacion concreta en Existencias y ubicaciones'; end if;
  select * into s from public.inventory_stock_positions where item_id=p_item_id;
  return public.manage_inventory_stock(p_request_id,p_item_id,p_type,s.id,s.lot_id,s.location_id,s.container_id,p_quantity,p_notes);
end $$;

alter function public.create_inventory_record(jsonb,uuid,numeric,text) rename to create_inventory_record_before_distribution;
create function public.create_inventory_record(p_record jsonb,p_container_id uuid default null,p_quantity numeric default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare item uuid; lot uuid; stock numeric;
begin
  if public.user_role() is null or public.user_role() not in ('admin','editor','operator') or
    (public.user_role()<>'admin' and (p_record->>'headquarters_id')::uuid is distinct from public.user_headquarters_id()) then raise exception 'No tienes permiso para crear en esta sede'; end if;
  stock=coalesce((p_record->>'current_stock')::numeric,0);
  if stock<0 or stock>99999999999.999 or stock<>round(stock,3) then raise exception 'Cantidad inicial no valida'; end if;
  if nullif(p_record->>'location_id','') is not null and not exists(select 1 from public.locations
    where id=(p_record->>'location_id')::uuid and headquarters_id=(p_record->>'headquarters_id')::uuid and is_active) then raise exception 'Ubicacion no disponible en esta sede'; end if;
  if p_container_id is not null and (nullif(p_record->>'location_id','') is not null or not exists(
    select 1 from public.inventory_containers where id=p_container_id and headquarters_id=(p_record->>'headquarters_id')::uuid and is_active
  )) then raise exception 'Caja no disponible o destino doble'; end if;
  item=public.create_inventory_record_before_distribution(p_record,null,p_quantity,p_notes);
  insert into public.inventory_stock_lots(item_id,code,expiration_date)
    values(item,coalesce(nullif(trim(p_record->>'lot_code'),''),'Inicial'),(p_record->>'expiration_date')::date) returning id into lot;
  insert into public.inventory_stock_positions(item_id,lot_id,location_id,container_id,quantity,notes)
    select item,lot,location_id,p_container_id,current_stock,coalesce(p_notes,'') from public.inventory_items where id=item;
  perform public.sync_inventory_stock(item);
  return item;
end $$;
alter function public.update_inventory_item(uuid,text,text,text,date,date,numeric,text) rename to update_inventory_item_before_distribution;
create function public.update_inventory_item(p_item_id uuid,p_name text,p_description text,p_status text,p_maintenance_due_at date,p_expiration_date date,p_minimum_stock numeric,p_notes text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede editar articulos'; end if;
  perform pg_advisory_xact_lock(90714001);
  if p_expiration_date is distinct from (select expiration_date from public.inventory_items where id=p_item_id) then
    if (select count(*) from public.inventory_stock_lots where item_id=p_item_id)<>1 then raise exception 'Edita la caducidad desde el lote concreto'; end if;
    update public.inventory_stock_lots set expiration_date=p_expiration_date where item_id=p_item_id;
  end if;
  perform public.update_inventory_item_before_distribution(p_item_id,p_name,p_description,p_status,p_maintenance_due_at,p_expiration_date,p_minimum_stock,p_notes);
  perform public.sync_inventory_stock(p_item_id);
end $$;

-- Preserve old checklist rows; new rows snapshot each lot separately.
alter table public.container_checklist_items drop constraint container_checklist_items_checklist_id_item_id_key;
alter table public.container_checklist_items add column lot_id uuid references public.inventory_stock_lots(id);
alter table public.container_checklist_items add column lot_code text;
alter table public.container_checklist_items add column expiration_date date;
create unique index checklist_item_lot on public.container_checklist_items(checklist_id,item_id,lot_id);

create or replace function public.create_container_checklist(p_id uuid,p_container_id uuid,p_event_type text,p_event_name text,p_event_date date,p_team_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare box public.inventory_containers; existing public.container_checklists; r text; total integer;
begin
  r:=public.user_role();
  if r is null or r not in ('admin','editor','operator','reader','viewer') then raise exception 'Necesitas una cuenta activa'; end if;
  if p_id is null or p_event_type is null or p_event_type not in ('practice','intervention') or p_event_date is null
    or length(trim(coalesce(p_event_name,''))) not between 3 and 160 or length(coalesce(p_team_name,''))>120 then raise exception 'Revisa actividad, fecha y equipo'; end if;
  -- Same lock as stock/placement changes, so the expected contents are one snapshot.
  perform pg_advisory_xact_lock(90714001);
  select * into existing from public.container_checklists where id=p_id;
  if found then
    if existing.created_by=auth.uid() and (r='admin' or existing.headquarters_id=public.user_headquarters_id())
      and existing.container_id=p_container_id and existing.event_type=p_event_type
      and existing.event_name=trim(p_event_name) and existing.event_date=p_event_date and existing.team_name=trim(coalesce(p_team_name,'')) then return existing.id; end if;
    raise exception 'Identificador de revision no disponible';
  end if;
  select * into box from public.inventory_containers where id=p_container_id and is_active;
  if not found or (r<>'admin' and box.headquarters_id is distinct from public.user_headquarters_id()) then raise exception 'Caja no disponible en tu sede'; end if;
  if not exists(select 1 from public.headquarters where id=box.headquarters_id and is_active) then raise exception 'La sede no esta activa'; end if;
  if box.location_id is not null and not exists(select 1 from public.locations where id=box.location_id and headquarters_id=box.headquarters_id) then raise exception 'La ubicacion de la caja no coincide con su sede'; end if;
  if exists(select 1 from public.container_checklists where container_id=box.id and status='draft') then raise exception 'Esta caja ya tiene una revision abierta. Abrela desde Checklists'; end if;
  insert into public.container_checklists(id,container_id,headquarters_id,container_name,location_name,event_type,event_name,event_date,team_name,created_by,created_by_name)
    values(p_id,box.id,box.headquarters_id,box.name,coalesce((select name from public.locations where id=box.location_id),'Sin ubicacion asignada'),
      p_event_type,trim(p_event_name),p_event_date,trim(coalesce(p_team_name,'')),auth.uid(),coalesce((select full_name from public.profiles where id=auth.uid()),'Miembro'));
  insert into public.container_checklist_items(checklist_id,item_id,item_name,unit,expected_quantity,lot_id,lot_code,expiration_date)
    select p_id,i.id,i.name,coalesce(nullif(trim(i.unit),''),'uds'),s.quantity,l.id,l.code,l.expiration_date
    from public.inventory_stock_positions s join public.inventory_items i on i.id=s.item_id
    join public.inventory_stock_lots l on l.id=s.lot_id where s.container_id=box.id and s.quantity>0;
  get diagnostics total=row_count;
  if total=0 then raise exception 'La caja esta vacia. Asigna su contenido antes de crear el checklist'; end if;
  return p_id;
end $$;


revoke execute on function public.sync_inventory_stock(uuid),public.create_inventory_record_before_distribution(jsonb,uuid,numeric,text),
  public.update_inventory_item_before_distribution(uuid,text,text,text,date,date,numeric,text) from public,anon,authenticated;
revoke execute on function public.manage_inventory_stock(uuid,uuid,text,uuid,uuid,uuid,uuid,numeric,text,text,date,numeric),
  public.create_inventory_record(jsonb,uuid,numeric,text),public.update_inventory_item(uuid,text,text,text,date,date,numeric,text) from public,anon,authenticated;
grant execute on function public.manage_inventory_stock(uuid,uuid,text,uuid,uuid,uuid,uuid,numeric,text,text,date,numeric),
  public.create_inventory_record(jsonb,uuid,numeric,text),public.update_inventory_item(uuid,text,text,text,date,date,numeric,text) to authenticated;
notify pgrst,'reload schema';
commit;
