begin;

create table public.container_checklists (
  id uuid primary key,
  container_id uuid not null references public.inventory_containers(id) on delete restrict,
  headquarters_id uuid not null references public.headquarters(id) on delete restrict,
  container_name text not null,
  location_name text not null,
  event_type text not null check(event_type in ('practice','intervention')),
  event_name text not null check(length(trim(event_name)) between 3 and 160),
  event_date date not null,
  team_name text not null default '' check(length(team_name)<=120),
  created_by uuid not null references public.profiles(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  status text not null default 'draft' check(status in ('draft','complete','issues','cancelled')),
  closed_by uuid references public.profiles(id),
  closed_by_name text,
  closed_at timestamptz,
  box_returned boolean not null default false,
  summary text not null default '' check(length(summary)<=2000)
);
create unique index container_checklists_one_draft on public.container_checklists(container_id) where status='draft';
create index container_checklists_site_date on public.container_checklists(headquarters_id,created_at desc);
create table public.container_checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.container_checklists(id) on delete restrict,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  item_name text not null,
  unit text not null,
  expected_quantity numeric not null check(expected_quantity>0 and expected_quantity<=99999999999.999 and expected_quantity=round(expected_quantity,3)),
  returned_quantity numeric check(returned_quantity>=0 and returned_quantity<=expected_quantity and returned_quantity=round(returned_quantity,3)),
  result text not null default 'pending' check(result in ('pending','ok','missing','damaged','consumed','misplaced')),
  notes text not null default '' check(length(notes)<=2000),
  checked_by uuid references public.profiles(id),
  checked_by_name text,
  checked_at timestamptz,
  revision integer not null default 0,
  unique(checklist_id,item_id),
  check(result<>'ok' or (returned_quantity is not null and returned_quantity=expected_quantity)),
  check(result in ('pending','ok') or length(trim(notes))>=3)
);
alter table public.container_checklists enable row level security;
alter table public.container_checklist_items enable row level security;
create policy checklists_read on public.container_checklists for select to authenticated
using(public.user_role()='admin' or (public.user_role() is not null and headquarters_id=public.user_headquarters_id()));
create policy checklist_items_read on public.container_checklist_items for select to authenticated
using(exists(select 1 from public.container_checklists c where c.id=checklist_id));
revoke all on public.container_checklists, public.container_checklist_items from public,anon,authenticated;
grant select on public.container_checklists, public.container_checklist_items to authenticated;

create function public.create_container_checklist(p_id uuid,p_container_id uuid,p_event_type text,p_event_name text,p_event_date date,p_team_name text)
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
  if exists(select 1 from public.inventory_container_items ci join public.inventory_items i on i.id=ci.item_id
    where ci.container_id=box.id and (i.headquarters_id is distinct from box.headquarters_id or ci.quantity<>i.current_stock or i.location_id is not null)) then
    raise exception 'El contenido de la caja tiene asignaciones inconsistentes. Pide a un administrador que lo revise';
  end if;
  insert into public.container_checklists(id,container_id,headquarters_id,container_name,location_name,event_type,event_name,event_date,team_name,created_by,created_by_name)
    values(p_id,box.id,box.headquarters_id,box.name,coalesce((select name from public.locations where id=box.location_id),'Sin ubicacion asignada'),
      p_event_type,trim(p_event_name),p_event_date,trim(coalesce(p_team_name,'')),auth.uid(),coalesce((select full_name from public.profiles where id=auth.uid()),'Miembro'));
  insert into public.container_checklist_items(checklist_id,item_id,item_name,unit,expected_quantity)
    select p_id,i.id,i.name,coalesce(nullif(trim(i.unit),''),'uds'),ci.quantity
    from public.inventory_container_items ci join public.inventory_items i on i.id=ci.item_id where ci.container_id=box.id;
  get diagnostics total=row_count;
  if total=0 then raise exception 'La caja esta vacia. Asigna su contenido antes de crear el checklist'; end if;
  return p_id;
end $$;

create function public.save_checklist_item(p_line_id uuid,p_revision integer,p_result text,p_quantity numeric,p_notes text)
returns void language plpgsql security definer set search_path='' as $$
declare c public.container_checklists; line public.container_checklist_items; r text;
begin
  r:=public.user_role();
  select * into line from public.container_checklist_items where id=p_line_id;
  select * into c from public.container_checklists where id=line.checklist_id for update;
  if not found or r is null or (r<>'admin' and c.headquarters_id is distinct from public.user_headquarters_id())
    or not (c.created_by=auth.uid() or public.can_manage_logistics_requests(c.headquarters_id)) then raise exception 'No puedes completar esta revision'; end if;
  if c.status<>'draft' then raise exception 'La revision ya esta cerrada'; end if;
  select * into line from public.container_checklist_items where id=p_line_id for update;
  if p_revision is null or line.revision<>p_revision then raise exception 'El articulo ha cambiado. Recarga antes de guardar' using errcode='40001'; end if;
  if p_result is null or p_result not in ('pending','ok','missing','damaged','consumed','misplaced')
    or length(coalesce(p_notes,''))>2000 then raise exception 'Resultado no valido'; end if;
  if p_result='ok' then p_quantity:=line.expected_quantity;
  elsif p_result='pending' then p_quantity:=null;
  elsif p_quantity is null or p_quantity<0 or p_quantity>line.expected_quantity or p_quantity<>round(p_quantity,3)
    or length(trim(coalesce(p_notes,'')))<3 then raise exception 'Indica cantidad comprobada y una nota para la incidencia'; end if;
  if p_result in ('missing','consumed') and p_quantity>=line.expected_quantity then raise exception 'La cantidad devuelta debe ser menor que la esperada'; end if;
  update public.container_checklist_items set result=p_result,returned_quantity=p_quantity,notes=trim(coalesce(p_notes,'')),
    checked_by=case when p_result='pending' then null else auth.uid() end,
    checked_by_name=case when p_result='pending' then null else coalesce((select full_name from public.profiles where id=auth.uid()),'Miembro') end,
    checked_at=case when p_result='pending' then null else clock_timestamp() end,revision=revision+1 where id=p_line_id;
end $$;

create function public.close_container_checklist(p_id uuid,p_box_returned boolean,p_summary text,p_cancel boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare c public.container_checklists; r text; final_status text;
begin
  r:=public.user_role();
  select * into c from public.container_checklists where id=p_id for update;
  if not found or r is null or (r<>'admin' and c.headquarters_id is distinct from public.user_headquarters_id())
    or not (c.created_by=auth.uid() or public.can_manage_logistics_requests(c.headquarters_id)) then raise exception 'No puedes cerrar esta revision'; end if;
  if c.status<>'draft' then raise exception 'La revision ya esta cerrada'; end if;
  if p_cancel is null or length(coalesce(p_summary,''))>2000 then raise exception 'Resumen no valido'; end if;
  if p_cancel then
    if length(trim(coalesce(p_summary,'')))<3 then raise exception 'Indica el motivo de cancelacion'; end if;
    final_status:='cancelled';
  else
    if exists(select 1 from public.container_checklist_items where checklist_id=c.id and result='pending') then raise exception 'Quedan articulos pendientes de comprobar'; end if;
    if not exists(select 1 from public.container_checklist_items where checklist_id=c.id) then raise exception 'La revision no tiene articulos'; end if;
    if not coalesce(p_box_returned,false) and length(trim(coalesce(p_summary,'')))<3 then raise exception 'Indica donde queda la caja si no ha vuelto a su ubicacion'; end if;
    final_status:=case when not coalesce(p_box_returned,false) or exists(select 1 from public.container_checklist_items where checklist_id=c.id and result<>'ok') then 'issues' else 'complete' end;
  end if;
  update public.container_checklists set status=final_status,closed_by=auth.uid(),closed_by_name=coalesce((select full_name from public.profiles where id=auth.uid()),'Miembro'),closed_at=clock_timestamp(),
    box_returned=case when p_cancel then false else coalesce(p_box_returned,false) end,summary=trim(coalesce(p_summary,'')) where id=c.id;
  return final_status;
end $$;
revoke execute on function public.create_container_checklist(uuid,uuid,text,text,date,text),public.save_checklist_item(uuid,integer,text,numeric,text),public.close_container_checklist(uuid,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.create_container_checklist(uuid,uuid,text,text,date,text),public.save_checklist_item(uuid,integer,text,numeric,text),public.close_container_checklist(uuid,boolean,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
