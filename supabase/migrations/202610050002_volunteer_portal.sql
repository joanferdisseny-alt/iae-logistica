begin;

insert into public.app_roles(code,name,description) values('volunteer','Voluntario (acceso personal)','Consulta sus entregas y solicita material; sin acceso al inventario general') on conflict(code) do nothing;

-- Existing inventory policies/RPCs use these helpers: a personal account has no operational role/site.
create or replace function public.user_role() returns text language sql stable security definer set search_path='' as $$
  select r.code from public.profiles p join public.app_roles r on r.id=p.role_id
  where p.id=auth.uid() and p.is_active and r.code in ('admin','editor','reader','operator','viewer')
$$;
create or replace function public.user_headquarters_id() returns uuid language sql stable security definer set search_path='' as $$
  select p.headquarters_id from public.profiles p where p.id=auth.uid() and p.is_active and public.user_role() is not null
$$;
create function public.portal_headquarters_id() returns uuid language sql stable security definer set search_path='' as $$
  select p.headquarters_id from public.profiles p join public.app_roles r on r.id=p.role_id
  where p.id=auth.uid() and p.is_active and r.code in ('admin','editor','reader','operator','viewer','volunteer')
$$;
revoke all on function public.portal_headquarters_id() from public,anon,authenticated;
grant execute on function public.portal_headquarters_id() to authenticated;

create function public.guard_personal_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.app_roles where id=new.role_id and code='volunteer') then
    new.is_logistics_contact=false;
  end if;
  return new;
end $$;
create trigger guard_personal_profile before insert or update of role_id,is_logistics_contact on public.profiles
for each row execute function public.guard_personal_profile();
revoke all on function public.guard_personal_profile() from public,anon,authenticated;

drop policy logistics_requests_read on public.logistics_requests;
drop policy logistics_requests_create on public.logistics_requests;
drop policy logistics_requests_cancel_own on public.logistics_requests;
create policy logistics_requests_read on public.logistics_requests for select to authenticated using(
  public.can_manage_logistics_requests(headquarters_id) or (created_by=auth.uid() and headquarters_id=public.portal_headquarters_id())
);
create policy logistics_requests_create on public.logistics_requests for insert to authenticated with check(
  created_by=auth.uid() and status='pending' and (public.user_role()='admin' or headquarters_id=public.portal_headquarters_id())
  and exists(select 1 from public.headquarters h where h.id=headquarters_id and h.is_active)
);
create policy logistics_requests_cancel_own on public.logistics_requests for update to authenticated
using(created_by=auth.uid() and headquarters_id=public.portal_headquarters_id() and status='pending')
with check(created_by=auth.uid() and headquarters_id=public.portal_headquarters_id() and status='cancelled');
drop policy "Headquarters readable by authenticated users" on public.headquarters;
create policy "Headquarters readable by authenticated users" on public.headquarters for select to authenticated
using(public.user_role()='admin' or id=public.portal_headquarters_id());

-- Personnel can exist before an Auth account is available; link accounts only by an explicit admin action.
create table public.volunteers (
  id uuid primary key default gen_random_uuid(),
  external_code text not null unique check(length(trim(external_code)) between 1 and 80),
  full_name text not null check(length(trim(full_name)) between 2 and 160),
  email text check(email is null or length(email)<=254),
  headquarters_id uuid not null references public.headquarters(id) on delete restrict,
  profile_id uuid unique references public.profiles(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index volunteers_site_name on public.volunteers(headquarters_id,full_name);
create table public.volunteer_deliveries (
  id uuid primary key,
  volunteer_id uuid not null references public.volunteers(id) on delete restrict,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  material text not null,
  size text,
  quantity integer not null check(quantity>0),
  returned_quantity integer not null default 0 check(returned_quantity>=0 and returned_quantity<=quantity),
  delivered_on date,
  historical boolean not null,
  source_position_id uuid references public.inventory_stock_positions(id),
  notes text not null,
  payload jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index volunteer_deliveries_owner on public.volunteer_deliveries(volunteer_id,created_at desc);
create table public.volunteer_returns (
  id uuid primary key,
  delivery_id uuid not null references public.volunteer_deliveries(id),
  quantity integer not null check(quantity>0),
  destination_id uuid not null references public.inventory_stock_positions(id),
  notes text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.volunteers enable row level security;
alter table public.volunteer_deliveries enable row level security;
alter table public.volunteer_returns enable row level security;
create policy volunteers_read on public.volunteers for select to authenticated
using(public.user_role()='admin' or (profile_id=auth.uid() and public.portal_headquarters_id() is not null));
create policy volunteer_deliveries_read on public.volunteer_deliveries for select to authenticated
using(exists(select 1 from public.volunteers v where v.id=volunteer_id));
create policy volunteer_returns_read on public.volunteer_returns for select to authenticated
using(exists(select 1 from public.volunteer_deliveries d where d.id=delivery_id));
revoke all on public.volunteers,public.volunteer_deliveries,public.volunteer_returns from public,anon,authenticated;
grant select on public.volunteers,public.volunteer_deliveries,public.volunteer_returns to authenticated;

create function public.save_volunteer(p_id uuid,p_code text,p_name text,p_email text,p_headquarters_id uuid,p_profile_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede gestionar voluntarios'; end if;
  perform pg_advisory_xact_lock(90714001);
  if not exists(select 1 from public.headquarters where id=p_headquarters_id and is_active) then raise exception 'Sede no disponible'; end if;
  if p_profile_id is not null and not exists(select 1 from public.profiles p join public.app_roles r on r.id=p.role_id
    where p.id=p_profile_id and p.is_active and (p.headquarters_id=p_headquarters_id or r.code='admin')) then raise exception 'El usuario no pertenece a esta sede o esta inactivo'; end if;
  if p_id is null then
    insert into public.volunteers(external_code,full_name,email,headquarters_id,profile_id)
      values(trim(p_code),trim(p_name),nullif(trim(p_email),''),p_headquarters_id,p_profile_id) returning id into result;
  else
    update public.volunteers set external_code=trim(p_code),full_name=trim(p_name),email=nullif(trim(p_email),''),headquarters_id=p_headquarters_id,profile_id=p_profile_id
      where id=p_id returning id into result;
    if result is null then raise exception 'Voluntario no encontrado'; end if;
  end if;
  return result;
end $$;

create function public.record_volunteer_delivery(p_id uuid,p_volunteer_id uuid,p_item_id uuid,p_quantity integer,p_historical boolean,p_delivered_on date,p_source_id uuid,p_notes text)
returns uuid language plpgsql security definer set search_path='' as $$
declare person public.volunteers; article public.inventory_items; src public.inventory_stock_positions; previous public.volunteer_deliveries; payload jsonb;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede registrar entregas'; end if;
  if p_id is null or p_quantity is null or p_quantity not between 1 and 1000000 or p_historical is null or
    p_delivered_on>current_date or length(coalesce(p_notes,''))>2000 or (not p_historical and p_delivered_on is null) or
    (p_historical and p_source_id is not null) then raise exception 'Revisa cantidad, fecha y tipo de entrega'; end if;
  payload=jsonb_build_object('volunteer',p_volunteer_id,'item',p_item_id,'quantity',p_quantity,'historical',p_historical,'date',p_delivered_on,'source',p_source_id,'notes',p_notes);
  perform pg_advisory_xact_lock(90714001);
  select * into previous from public.volunteer_deliveries where id=p_id;
  if found then
    if previous.created_by<>auth.uid() or previous.payload<>payload then raise exception 'Identificador de entrega reutilizado con otros datos'; end if;
    return previous.id;
  end if;
  select * into person from public.volunteers where id=p_volunteer_id and is_active;
  if not found then raise exception 'Voluntario no disponible'; end if;
  select * into article from public.inventory_items where id=p_item_id and headquarters_id=person.headquarters_id;
  if not found then raise exception 'Articulo no disponible en la sede del voluntario'; end if;
  if not p_historical then
    if not exists(select 1 from public.headquarters where id=person.headquarters_id and is_active) then raise exception 'La sede esta inactiva'; end if;
    select * into src from public.inventory_stock_positions where id=p_source_id and item_id=p_item_id;
    if not found then raise exception 'Selecciona la existencia de origen'; end if;
    perform public.manage_inventory_stock(p_id,p_item_id,'out',src.id,src.lot_id,null,null,p_quantity,'Entrega a '||person.full_name||': '||coalesce(p_notes,''));
  end if;
  insert into public.volunteer_deliveries(id,volunteer_id,item_id,material,size,quantity,delivered_on,historical,source_position_id,notes,payload,created_by)
    values(p_id,person.id,article.id,article.name,article.technical_specs->>'uniformidad_talla',p_quantity,p_delivered_on,p_historical,p_source_id,coalesce(p_notes,''),payload,auth.uid());
  return p_id;
end $$;

create function public.return_volunteer_delivery(p_id uuid,p_delivery_id uuid,p_quantity integer,p_destination_id uuid,p_notes text)
returns uuid language plpgsql security definer set search_path='' as $$
declare delivery public.volunteer_deliveries; dest public.inventory_stock_positions; previous public.volunteer_returns;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede registrar devoluciones'; end if;
  if p_id is null or p_quantity is null or p_quantity<=0 or length(trim(coalesce(p_notes,''))) not between 3 and 1800 then raise exception 'Indica cantidad positiva y motivo'; end if;
  perform pg_advisory_xact_lock(90714001);
  select * into previous from public.volunteer_returns where id=p_id;
  if found then
    if previous.delivery_id<>p_delivery_id or previous.quantity<>p_quantity or previous.destination_id<>p_destination_id or previous.notes is distinct from p_notes or previous.created_by<>auth.uid() then raise exception 'Identificador de devolucion reutilizado'; end if;
    return previous.id;
  end if;
  select * into delivery from public.volunteer_deliveries where id=p_delivery_id for update;
  if not found or p_quantity>delivery.quantity-delivery.returned_quantity then raise exception 'Cantidad superior al material pendiente de devolver'; end if;
  select * into dest from public.inventory_stock_positions where id=p_destination_id and item_id=delivery.item_id;
  if not found then raise exception 'El destino debe ser una existencia del mismo articulo'; end if;
  perform public.manage_inventory_stock(p_id,delivery.item_id,'in',null,dest.lot_id,dest.location_id,dest.container_id,p_quantity,'Devolucion de voluntario: '||p_notes);
  update public.volunteer_deliveries set returned_quantity=returned_quantity+p_quantity where id=delivery.id;
  insert into public.volunteer_returns(id,delivery_id,quantity,destination_id,notes,created_by) values(p_id,delivery.id,p_quantity,dest.id,p_notes,auth.uid());
  return p_id;
end $$;
revoke all on function public.save_volunteer(uuid,text,text,text,uuid,uuid),public.record_volunteer_delivery(uuid,uuid,uuid,integer,boolean,date,uuid,text),public.return_volunteer_delivery(uuid,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.save_volunteer(uuid,text,text,text,uuid,uuid),public.record_volunteer_delivery(uuid,uuid,uuid,integer,boolean,date,uuid,text),public.return_volunteer_delivery(uuid,uuid,integer,uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
