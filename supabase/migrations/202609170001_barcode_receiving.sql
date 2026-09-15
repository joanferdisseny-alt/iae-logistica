begin;

create table public.inventory_variants (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id),
  brand text not null check(length(trim(brand)) between 1 and 80),
  model text not null default '' check(length(model)<=80),
  unique(item_id,brand,model), unique(id,item_id)
);
create table public.inventory_barcodes (
  id uuid primary key default gen_random_uuid(),
  headquarters_id uuid not null references public.headquarters(id),
  item_id uuid not null references public.inventory_items(id),
  variant_id uuid not null,
  code text not null check(code ~ '^[!-~]{1,128}$'),
  units_per_pack numeric not null check(units_per_pack>0 and units_per_pack<=999999 and units_per_pack=round(units_per_pack,3)),
  foreign key(variant_id,item_id) references public.inventory_variants(id,item_id),
  unique(headquarters_id,code)
);
alter table public.inventory_stock_lots add column variant_id uuid;
alter table public.inventory_stock_lots add foreign key(variant_id,item_id) references public.inventory_variants(id,item_id);
create table public.inventory_receipts (
  id uuid primary key,
  item_id uuid not null references public.inventory_items(id),
  actor_id uuid not null references public.profiles(id),
  payload jsonb not null,
  balance_after numeric not null,
  created_at timestamptz not null default now()
);
create table public.barcode_catalog_requests (
  id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  payload jsonb not null,
  request_id uuid not null references public.logistics_requests(id)
);
create table public.inventory_creation_requests (
  id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  payload jsonb not null,
  item_id uuid not null references public.inventory_items(id)
);
alter table public.inventory_variants enable row level security;
alter table public.inventory_barcodes enable row level security;
alter table public.inventory_receipts enable row level security;
alter table public.barcode_catalog_requests enable row level security;
alter table public.inventory_creation_requests enable row level security;
create policy variants_read on public.inventory_variants for select to authenticated using(exists(select 1 from public.inventory_items i where i.id=item_id));
create policy barcodes_read on public.inventory_barcodes for select to authenticated using(exists(select 1 from public.inventory_items i where i.id=item_id));
create policy receipts_read on public.inventory_receipts for select to authenticated using(exists(select 1 from public.inventory_items i where i.id=item_id));
revoke all on public.inventory_variants,public.inventory_barcodes,public.inventory_receipts,public.barcode_catalog_requests,public.inventory_creation_requests from public,anon,authenticated;
grant select on public.inventory_variants,public.inventory_barcodes,public.inventory_receipts to authenticated;

create function public.link_inventory_barcode(p_item_id uuid,p_code text,p_brand text,p_model text,p_units numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare site uuid; variant uuid; existing public.inventory_barcodes; result uuid;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede asociar codigos'; end if;
  if p_code is null or p_code !~ '^[!-~]{1,128}$' or length(trim(coalesce(p_brand,''))) not between 1 and 80
    or p_model is null or length(p_model)>80 or p_units is null or p_units<=0 or p_units>999999 or p_units<>round(p_units,3) then raise exception 'Revisa codigo, marca y unidades por envase'; end if;
  perform pg_advisory_xact_lock(90714001);
  select i.headquarters_id into site from public.inventory_items i join public.headquarters h on h.id=i.headquarters_id and h.is_active where i.id=p_item_id;
  if not found then raise exception 'Articulo o sede no disponible'; end if;
  insert into public.inventory_variants(item_id,brand,model) values(p_item_id,trim(p_brand),trim(p_model))
    on conflict(item_id,brand,model) do nothing;
  select id into variant from public.inventory_variants where item_id=p_item_id and brand=trim(p_brand) and model=trim(p_model);
  select * into existing from public.inventory_barcodes where headquarters_id=site and code=p_code;
  if found then
    if existing.variant_id<>variant or existing.units_per_pack<>p_units then raise exception 'Este codigo ya esta asociado a otro producto o envase en la sede'; end if;
    return existing.id;
  end if;
  insert into public.inventory_barcodes(headquarters_id,item_id,variant_id,code,units_per_pack)
    values(site,p_item_id,variant,p_code,p_units) returning id into result;
  insert into public.inventory_item_history(item_id,actor_id,event_type,details)
    values(p_item_id,auth.uid(),'barcode_linked',jsonb_build_object('code',p_code,'brand',trim(p_brand),'model',trim(p_model),'units_per_pack',p_units));
  return result;
end $$;

-- One transaction covers all destinations. The receipt identifier survives retries.
create function public.receive_inventory_barcode(p_id uuid,p_barcode_id uuid,p_packs numeric,p_lot_code text,p_expiration date,p_allocations jsonb,p_notes text)
returns numeric language plpgsql security definer set search_path='' as $$
declare b public.inventory_barcodes; v public.inventory_variants; old public.inventory_receipts;
  payload jsonb; total numeric; allocated numeric:=0; part jsonb; amount numeric; lot uuid; balance numeric;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede registrar entradas'; end if;
  if p_id is null or p_packs is null or p_packs<=0 or p_packs>99999999999 or p_packs<>trunc(p_packs)
    or p_lot_code is null or length(p_lot_code)>80 or length(trim(coalesce(p_notes,''))) not between 3 and 1000
    or p_allocations is null or jsonb_typeof(p_allocations)<>'array' then raise exception 'Revisa envases, lote, motivo y reparto'; end if;
  if jsonb_array_length(p_allocations) not between 1 and 100 then raise exception 'Elige entre 1 y 100 destinos'; end if;
  payload=jsonb_build_object('barcode_id',p_barcode_id,'packs',p_packs,'lot_code',p_lot_code,'expiration',p_expiration,'allocations',p_allocations,'notes',p_notes);
  perform pg_advisory_xact_lock(90714001);
  select * into old from public.inventory_receipts where id=p_id;
  if found then
    if old.actor_id<>auth.uid() or old.payload<>payload then raise exception 'Identificador reutilizado con datos distintos'; end if;
    return old.balance_after;
  end if;
  select * into b from public.inventory_barcodes where id=p_barcode_id;
  if not found then raise exception 'Codigo no encontrado'; end if;
  if p_expiration is null and exists(select 1 from public.inventory_items i
    join public.inventory_template_fields f on f.template_id=i.template_id
    join public.inventory_fields d on d.id=f.field_id
    where i.id=b.item_id and f.is_required and d.field_key='expiration_date') then
    raise exception 'La ficha de este articulo exige fecha de caducidad para cada lote';
  end if;
  select * into v from public.inventory_variants where id=b.variant_id;
  total=p_packs*b.units_per_pack;
  if total>99999999999.999 or total<>round(total,3) then raise exception 'Cantidad total fuera de rango'; end if;
  for part in select value from jsonb_array_elements(p_allocations) loop
    amount=(part->>'quantity')::numeric;
    if amount is null or amount<=0 or amount>99999999999.999 or amount<>round(amount,3) then raise exception 'Cada destino necesita una cantidad positiva con hasta 3 decimales'; end if;
    allocated=allocated+amount;
  end loop;
  if allocated<>total then raise exception 'El reparto no coincide con las unidades recibidas'; end if;
  insert into public.inventory_stock_lots(item_id,variant_id,code,expiration_date)
    values(b.item_id,b.variant_id,left(v.brand||case when v.model<>'' then ' / '||v.model else '' end,40)||' / '||
      left(coalesce(nullif(trim(p_lot_code),''),'Recepcion '||current_date),34)||' / '||p_id::text,p_expiration) returning id into lot;
  for part in select value from jsonb_array_elements(p_allocations) loop
    balance=public.manage_inventory_stock(gen_random_uuid(),b.item_id,'in',null,lot,
      nullif(part->>'location_id','')::uuid,nullif(part->>'container_id','')::uuid,(part->>'quantity')::numeric,
      'Recepcion '||p_id::text||': '||p_notes);
  end loop;
  insert into public.inventory_receipts(id,item_id,actor_id,payload,balance_after) values(p_id,b.item_id,auth.uid(),payload,balance);
  insert into public.inventory_item_history(item_id,actor_id,event_type,details)
    values(b.item_id,auth.uid(),'barcode_received',payload||jsonb_build_object('variant_id',v.id,'brand',v.brand,'model',v.model,'code',b.code,'units_per_pack',b.units_per_pack,'total',total,'receipt_id',p_id));
  return balance;
end $$;

create function public.request_barcode_cataloging(p_id uuid,p_site uuid,p_code text,p_description text,p_packs numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare old public.barcode_catalog_requests; payload jsonb; request uuid; r text;
begin
  r=public.user_role();
  if r is null or (r<>'admin' and p_site is distinct from public.user_headquarters_id()) then raise exception 'No puedes solicitar en esta sede'; end if;
  if not exists(select 1 from public.headquarters where id=p_site and is_active) then raise exception 'Sede inactiva'; end if;
  if p_id is null or p_code is null or p_code !~ '^[!-~]{1,128}$' or length(trim(coalesce(p_description,''))) not between 3 and 1000
    or p_packs is null or p_packs<=0 or p_packs>999999999 or p_packs<>trunc(p_packs) then raise exception 'Revisa codigo, descripcion y envases'; end if;
  payload=jsonb_build_object('site',p_site,'code',p_code,'description',p_description,'packs',p_packs);
  perform pg_advisory_xact_lock(90714001);
  select * into old from public.barcode_catalog_requests where id=p_id;
  if found then
    if old.actor_id<>auth.uid() or old.payload<>payload then raise exception 'Identificador reutilizado'; end if;
    return old.request_id;
  end if;
  insert into public.logistics_requests(headquarters_id,created_by,material,quantity,unit,notes)
    values(p_site,auth.uid(),'Catalogar: '||left(trim(p_description),140),p_packs,'envases',
      'PENDIENTE DE CATALOGACION. No se ha registrado stock. Codigo: '||p_code||E'\n'||p_description) returning id into request;
  insert into public.barcode_catalog_requests values(p_id,auth.uid(),payload,request);
  return request;
end $$;

create function public.create_inventory_record_once(p_id uuid,p_record jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare old public.inventory_creation_requests; item uuid;
begin
  if public.user_role() is null or public.user_role() not in ('admin','editor','operator') or
    (public.user_role()<>'admin' and (p_record->>'headquarters_id')::uuid is distinct from public.user_headquarters_id()) then raise exception 'No puedes crear en esta sede'; end if;
  if p_id is null or coalesce((p_record->>'current_stock')::numeric,0)<>0 then raise exception 'Esta alta de catalogo debe empezar sin stock'; end if;
  perform pg_advisory_xact_lock(90714001);
  select * into old from public.inventory_creation_requests where id=p_id;
  if found then
    if old.actor_id<>auth.uid() or old.payload<>p_record then raise exception 'Identificador de alta reutilizado'; end if;
    return old.item_id;
  end if;
  item=public.create_inventory_record(p_record,null,0,null);
  insert into public.inventory_creation_requests values(p_id,auth.uid(),p_record,item);
  return item;
end $$;

revoke execute on function public.link_inventory_barcode(uuid,text,text,text,numeric),
  public.receive_inventory_barcode(uuid,uuid,numeric,text,date,jsonb,text),public.request_barcode_cataloging(uuid,uuid,text,text,numeric),
  public.create_inventory_record_once(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.link_inventory_barcode(uuid,text,text,text,numeric),
  public.receive_inventory_barcode(uuid,uuid,numeric,text,date,jsonb,text),public.request_barcode_cataloging(uuid,uuid,text,text,numeric),
  public.create_inventory_record_once(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
