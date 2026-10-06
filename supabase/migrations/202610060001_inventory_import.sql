begin;

create index inventory_import_sku_lookup on public.inventory_items(headquarters_id,lower(trim(sku)));
create index inventory_import_name_lookup on public.inventory_items(headquarters_id,category,lower(trim(name)));

create table public.inventory_import_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  filename text not null check(length(filename) between 1 and 200),
  reference text not null check(length(reference) between 3 and 80),
  -- Snapshot IDs: abandoned previews must not prevent deleting empty destinations.
  -- The executor checks the site and destination again on every confirmation.
  headquarters_id uuid not null,
  location_id uuid,
  container_id uuid,
  payload jsonb not null,
  plan jsonb not null,
  imported_at timestamptz,
  check(location_id is null or container_id is null)
);
create unique index inventory_import_receipt_once on public.inventory_import_drafts(headquarters_id,lower(reference)) where imported_at is not null;
alter table public.inventory_import_drafts enable row level security;
create policy inventory_import_drafts_read on public.inventory_import_drafts for select to authenticated using(public.user_role()='admin' and created_by=auth.uid());
revoke all on public.inventory_import_drafts from public,anon,authenticated;
grant select on public.inventory_import_drafts to authenticated;

-- Shared by preview and commit. Preview uses a subtransaction to run the real
-- constraints and stock functions, then rolls back *all* catalogue/stock writes.
-- PL/pgSQL local variables survive that rollback; only the plan is returned.
create function public.execute_inventory_import(p_payload jsonb,p_site uuid,p_location uuid,p_container uuid,p_reference text,p_preview boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  r jsonb; f jsonb; category_name text; parent text; category_code text; codes text[]; ids uuid[];
  item public.inventory_items; template public.inventory_templates; field public.inventory_fields; lot public.inventory_stock_lots;
  template_name text; category_path text; new_item boolean; qty numeric; before_qty numeric; article uuid; lot_code text;
  sku text; seen uuid[]='{}'; key text; value text; field_type text; n integer=0; field_order integer;
  lines jsonb='[]'; categories jsonb='[]'; templates jsonb='[]'; fields jsonb='[]'; assignments jsonb='[]'; result jsonb;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede importar'; end if;
  perform pg_advisory_xact_lock(90714001);
  if p_reference is null or length(trim(p_reference)) not between 3 and 80 then raise exception 'Indica una referencia de carga de 3 a 80 caracteres'; end if;
  if not exists(select 1 from public.headquarters where id=p_site and is_active) then raise exception 'Sede no disponible'; end if;
  if p_location is not null and p_container is not null then raise exception 'Elige ubicacion o caja, no ambas'; end if;
  if p_location is not null and not exists(select 1 from public.locations where id=p_location and headquarters_id=p_site and is_active) then raise exception 'Ubicacion no disponible en esta sede'; end if;
  if p_container is not null and not exists(select 1 from public.inventory_containers where id=p_container and headquarters_id=p_site and is_active) then raise exception 'Caja no disponible en esta sede'; end if;
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_typeof(p_payload->'fields') is distinct from 'array' then raise exception 'Formato de importacion no valido'; end if;
  if jsonb_array_length(p_payload->'rows') not between 1 and 500 or jsonb_array_length(p_payload->'fields')>40 or octet_length(p_payload::text)>800000 then raise exception 'Maximo 500 articulos y 40 campos por carga'; end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'fields') e group by e->>'key' having count(*)>1) then raise exception 'Hay claves de campo repetidas'; end if;
  begin
    for f in select * from jsonb_array_elements(p_payload->'fields') loop
      key=f->>'key'; field_type=f->>'type';
      if key is null or key !~ '^[a-z][a-z0-9_]{0,59}$' or length(coalesce(f->>'label','')) not between 1 and 120 or field_type is null or field_type not in ('text','textarea','number','date','boolean','select') then raise exception 'Definicion de campo no valida'; end if;
      if key in ('id','item_name','subtype','location_id','headquarters_id','category','template_id','maintenance_due_at') then raise exception 'Clave reservada: %',key; end if;
      if (key in ('name','sku','serial_number','unit','lot_code') and field_type<>'text') or (key in ('current_stock','minimum_stock') and field_type<>'number') or (key='expiration_date' and field_type<>'date') or (key='is_consumable' and field_type<>'boolean') or (key='description' and field_type not in ('text','textarea')) then raise exception 'Tipo incompatible para el campo %',key; end if;
      select * into field from public.inventory_fields where field_key=key;
      if found then
        if field.field_type<>field_type and not (key='description' and field.field_type in ('text','textarea')) then raise exception 'El campo % ya existe con tipo %. Revisa la asignacion de columnas',key,field.field_type; end if;
      else
        if field_type='select' then raise exception 'Crea primero el campo desplegable % y sus opciones en Campos',key; end if;
        insert into public.inventory_fields(field_key,label,field_type) values(key,f->>'label',field_type);
        fields=fields||jsonb_build_array((f->>'label')||' ['||key||', '||field_type||']');
      end if;
    end loop;
    for r in select * from jsonb_array_elements(p_payload->'rows') loop
      n=n+1; item=null; template=null; parent=null; category_code=null; category_path='';
      if jsonb_typeof(r->'category') is distinct from 'array' or jsonb_typeof(r->'specs') is distinct from 'object' then raise exception 'Fila %: categoria o campos no validos',n+1; end if;
      if jsonb_array_length(r->'category')>5 or coalesce(r->>'quantity','') !~ '^[0-9]+(\.[0-9]{1,3})?$' then raise exception 'Fila %: cantidad o categoria no valida',n+1; end if;
      qty=(r->>'quantity')::numeric;
      if qty>1000000 then raise exception 'Fila %: cantidad superior a 1000000',n+1; end if;
      if exists(select 1 from jsonb_each_text(r->'specs') s where length(s.value)>2000 or not exists(select 1 from jsonb_array_elements(p_payload->'fields') d where d->>'key'=s.key) or s.key in ('name','sku','current_stock','minimum_stock','unit','expiration_date','lot_code','is_consumable','description','serial_number')) then raise exception 'Fila %: campos desconocidos o reservados',n+1; end if;
      if coalesce(r->>'expiration_date','')<>'' and (r->>'expiration_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char((r->>'expiration_date')::date,'YYYY-MM-DD')<>r->>'expiration_date') then raise exception 'Fila %: caducidad no valida',n+1; end if;
      if coalesce(r->>'minimum_stock','')<>'' and (r->>'minimum_stock' !~ '^[0-9]+(\.[0-9]{1,3})?$' or (r->>'minimum_stock')::numeric>1000000) then raise exception 'Fila %: stock minimo no valido',n+1; end if;
      if coalesce(r->>'is_consumable','')<>'' and r->>'is_consumable' not in ('true','false') then raise exception 'Fila %: fungible debe ser true o false',n+1; end if;
      if exists(select 1 from jsonb_each_text(r) e where e.key not in ('category','specs') and length(e.value)>2000) or length(coalesce(r->>'sku',''))>120 or length(coalesce(r->>'name',''))>200 or length(coalesce(r->>'unit',''))>40 or length(coalesce(r->>'lot_code',''))>120 then raise exception 'Fila %: texto demasiado largo',n+1; end if;
      sku=nullif(trim(r->>'sku'),'');
      if nullif(r->>'id','') is not null then
        select * into item from public.inventory_items where id=(r->>'id')::uuid and headquarters_id=p_site;
        if not found then raise exception 'Fila %: ID no disponible en la sede seleccionada',n+1; end if;
        if sku is not null and lower(item.sku) is distinct from lower(sku) then raise exception 'Fila %: ID y SKU no corresponden al mismo articulo',n+1; end if;
      elsif sku is not null then
        select array_agg(id order by id) into ids from public.inventory_items where headquarters_id=p_site and lower(trim(inventory_items.sku))=lower(sku);
        if cardinality(ids)>1 then raise exception 'Fila %: SKU duplicado en la sede. Indica el ID exacto del articulo',n+1; end if;
        select * into item from public.inventory_items where id=ids[1];
      end if;
      for category_name in select jsonb_array_elements_text(r->'category') loop
        if length(trim(category_name)) not between 1 and 120 then raise exception 'Fila %: nombre de categoria no valido',n+1; end if;
        select array_agg(code order by code) into codes from public.inventory_categories c where c.parent_code is not distinct from parent and (lower(trim(c.name))=lower(trim(category_name)) or c.code=category_name);
        if cardinality(codes)>1 then raise exception 'Fila %: categoria ambigua %. Usa su codigo',n+1,category_name; end if;
        category_code=codes[1];
        if category_code is null then
          category_code='imp_'||md5(coalesce(parent,'')||'/'||lower(trim(category_name)));
          insert into public.inventory_categories(code,name,parent_code) values(category_code,trim(category_name),parent);
          categories=categories||jsonb_build_array(category_path||trim(category_name));
        end if;
        category_path=category_path||(select name from public.inventory_categories where code=category_code)||' > ';
        parent=category_code;
      end loop;
      if item.id is null and sku is null and nullif(r->>'template','') is null then
        select array_agg(i.id order by i.id) into ids from public.inventory_items i where i.headquarters_id=p_site and lower(trim(i.name))=lower(trim(r->>'name')) and i.category=category_code
          and coalesce((select jsonb_object_agg(s.key,s.value) from jsonb_each_text(i.technical_specs) s where s.key not in ('name','item_name','current_stock','sku','unit','lot_code','expiration_date','serial_number','minimum_stock','is_consumable','description','location_id','subtype','maintenance_due_at')),'{}')=r->'specs';
        if cardinality(ids)>1 then raise exception 'Fila %: varios articulos coinciden. Indica SKU o ID',n+1; end if;
        select * into item from public.inventory_items where id=ids[1];
      end if;
      if item.id is not null then
        if category_code is not null and category_code is distinct from item.category then raise exception 'Fila %: categoria distinta a la del articulo identificado',n+1; end if;
        category_code=item.category;
        if nullif(r->>'template','') is null then select * into template from public.inventory_templates where id=item.template_id; end if;
      end if;
      if category_code is null then raise exception 'Fila %: un articulo nuevo necesita categoria y nombre, o un SKU/ID existente',n+1; end if;
      if template.id is null and nullif(r->>'template','') is null then
        select array_agg(t.id order by t.id) into ids from public.inventory_templates t where t.category_code=category_code
          and coalesce((select jsonb_agg(a.field_key order by a.field_key) from public.inventory_template_fields a where a.template_id=t.id
            and a.field_key not in ('name','item_name','current_stock','sku','unit','lot_code','expiration_date','serial_number','minimum_stock','is_consumable','description','location_id','subtype','maintenance_due_at')),'[]')
            =coalesce((select jsonb_agg(s.key order by s.key) from jsonb_each(r->'specs') s),'[]');
        if cardinality(ids)>1 then raise exception 'Fila %: varios tipos de ficha tienen estos campos. Indica el tipo o su codigo',n+1; end if;
        select * into template from public.inventory_templates where id=ids[1];
      end if;
      if template.id is null then
        template_name=coalesce(nullif(trim(r->>'template'),''),(select name from public.inventory_categories where code=category_code));
        if length(template_name) not between 1 and 120 then raise exception 'Fila %: tipo de articulo no valido',n+1; end if;
        select array_agg(id order by id) into ids from public.inventory_templates t where t.category_code=category_code and (lower(trim(t.name))=lower(template_name) or t.code=template_name);
        if cardinality(ids)>1 then raise exception 'Fila %: tipo de articulo ambiguo. Indica su codigo',n+1; end if;
        select * into template from public.inventory_templates where id=ids[1];
        if template.id is null then
          insert into public.inventory_templates(code,name,category_code) values('imp_'||md5(category_code||'/'||lower(template_name)),template_name,category_code) returning * into template;
          templates=templates||jsonb_build_array(template.name||' ['||category_code||']');
        end if;
      end if;
      if item.id is null and sku is null then
        -- Without an identifier, require exact characteristics, not just a shared type.
        select array_agg(i.id order by i.id) into ids from public.inventory_items i where i.headquarters_id=p_site and lower(trim(i.name))=lower(trim(r->>'name')) and i.category=category_code
          and i.template_id=template.id and coalesce((select jsonb_object_agg(s.key,s.value) from jsonb_each_text(i.technical_specs) s where s.key not in ('name','item_name','current_stock','sku','unit','lot_code','expiration_date','serial_number','minimum_stock','is_consumable','description','location_id','subtype','maintenance_due_at')),'{}')=r->'specs';
        if cardinality(ids)>1 then raise exception 'Fila %: varios articulos coinciden. Indica SKU o ID',n+1; end if;
        select * into item from public.inventory_items where id=ids[1];
        if item.id is null and exists(select 1 from public.inventory_items i where i.headquarters_id=p_site and lower(trim(i.name))=lower(trim(r->>'name')) and i.category=category_code) then raise exception 'Fila %: ese nombre ya existe con otras caracteristicas. Usa el SKU/ID existente o una nueva referencia SKU para otro producto',n+1; end if;
      end if;
      new_item=item.id is null;
      if not new_item then
        if item.template_id is distinct from template.id then raise exception 'Fila %: el tipo de ficha no coincide con el articulo',n+1; end if;
        if item.operational_status='retired' then raise exception 'Fila %: no se puede reponer un articulo retirado',n+1; end if;
        if nullif(r->>'name','') is not null and lower(trim(item.name))<>lower(trim(r->>'name')) then raise exception 'Fila %: el nombre no coincide con el SKU/ID. La importacion no modifica fichas existentes',n+1; end if;
        for key,value in select * from jsonb_each_text(r->'specs') loop
          if item.technical_specs->>key is distinct from value then raise exception 'Fila %: el campo % no coincide con el articulo existente',n+1,key; end if;
        end loop;
        if (nullif(r->>'unit','') is not null and r->>'unit' is distinct from item.unit) or
          (nullif(r->>'serial_number','') is not null and r->>'serial_number' is distinct from item.serial_number) or
          (nullif(r->>'minimum_stock','') is not null and (r->>'minimum_stock')::numeric is distinct from item.minimum_stock) or
          (nullif(r->>'is_consumable','') is not null and (r->>'is_consumable')::boolean is distinct from item.is_consumable) or
          (nullif(r->>'description','') is not null and r->>'description' is distinct from item.description) then raise exception 'Fila %: los datos no coinciden. El importador suma stock, no edita datos existentes',n+1; end if;
      elsif length(trim(coalesce(r->>'name',''))) not between 1 and 200 then raise exception 'Fila %: el articulo nuevo necesita un nombre',n+1;
      end if;
      field_order=coalesce((select max(sort_order)+1 from public.inventory_template_fields where template_id=template.id),0);
      for f in select * from jsonb_array_elements(p_payload->'fields') loop
        key=f->>'key';
        -- Empty custom cells are absent characteristics, not a request to alter a type.
        if key not in ('name','current_stock') and not (r ? key or r->'specs' ? key) then continue; end if;
        select * into field from public.inventory_fields where field_key=key;
        if not exists(select 1 from public.inventory_template_fields a where a.template_id=template.id and a.field_key=key) then
          insert into public.inventory_template_fields(template_id,field_id,field_key,label,field_type,options,sort_order) values(template.id,field.id,field.field_key,field.label,field.field_type,field.options,field_order);
          field_order=field_order+1;
          assignments=assignments||jsonb_build_array(template.name||': '||field.label||' ['||key||']');
        end if;
      end loop;
      lot_code=coalesce(nullif(trim(r->>'lot_code'),''),'IMP-'||substr(md5(lower(p_reference)),1,20));
      before_qty=coalesce(item.current_stock,0);
      if new_item then
        sku=coalesce(sku,'IMP-'||substr(md5(p_site::text||'/'||lower(p_reference)||'/'||n::text),1,20));
        article=public.create_inventory_record(jsonb_build_object('name',trim(r->>'name'),'slug','import-'||gen_random_uuid()::text,
          'sku',sku,'template_id',template.id,'headquarters_id',p_site,'location_id',p_location,'current_stock',qty,
          'unit',coalesce(nullif(r->>'unit',''),'unidades'),'technical_specs',r->'specs','lot_code',lot_code,
          'expiration_date',nullif(r->>'expiration_date',''),'serial_number',nullif(r->>'serial_number',''),
          'minimum_stock',coalesce(nullif(r->>'minimum_stock',''),'0')::numeric,'is_consumable',coalesce(nullif(r->>'is_consumable',''),'false')::boolean,
          'description',nullif(r->>'description','')),p_container,qty,'Importacion CSV/Excel: '||p_reference);
        select * into item from public.inventory_items where id=article;
      else
        article=item.id;
        if article=any(seen) then raise exception 'Fila %: el articulo se repite en el archivo. Agrupa las cantidades o separa las cargas por lote/destino',n+1; end if;
        if qty>0 then
          if nullif(r->>'expiration_date','') is null and exists(select 1 from public.inventory_template_fields where template_id=template.id and field_key='expiration_date' and is_required) then raise exception 'Fila %: falta la caducidad obligatoria del lote que entra',n+1; end if;
          select * into lot from public.inventory_stock_lots l where l.item_id=article and l.code=lot_code;
          if lot.id is not null then
            if lot.expiration_date is distinct from nullif(r->>'expiration_date','')::date or lot.variant_id is not null then raise exception 'Fila %: el lote ya existe con otra caducidad o marca. Usa otro lote o Recibir material',n+1; end if;
            perform public.manage_inventory_stock(gen_random_uuid(),article,'in',null,lot.id,p_location,p_container,qty,'Importacion CSV/Excel: '||p_reference);
          else
            perform public.manage_inventory_stock(gen_random_uuid(),article,'new_lot',null,null,p_location,p_container,qty,'Importacion CSV/Excel: '||p_reference,lot_code,nullif(r->>'expiration_date','')::date);
          end if;
        end if;
      end if;
      seen=array_append(seen,article);
      insert into public.inventory_item_history(item_id,actor_id,event_type,details) values(article,auth.uid(),'csv_import',jsonb_build_object('reference',p_reference,'row',n+1,'quantity',qty));
      lines=lines||jsonb_build_array(jsonb_build_object('row',n+1,'name',item.name,'sku',item.sku,'item_id',case when new_item then null else article end,
        'action',case when new_item then 'create' else 'add' end,'category',category_code,'template',template.name,'before',before_qty,'quantity',qty,'after',before_qty+qty,
        'lot',lot_code,'expiration',nullif(r->>'expiration_date',''),'specs',item.technical_specs,
        'details',jsonb_build_object('unit',item.unit,'serial_number',item.serial_number,'minimum_stock',item.minimum_stock,'is_consumable',item.is_consumable,'description',item.description)));
    end loop;
    result=jsonb_build_object('lines',lines,'categories',categories,'templates',templates,'fields',fields,'assignments',assignments);
    if p_preview then raise exception using errcode='PIV01',message='rollback import preview'; end if;
  exception when sqlstate 'PIV01' then
    if not p_preview then raise; end if;
  when others then
    raise exception 'Carga cancelada (fila %): %',n+1,sqlerrm;
  end;
  return result;
end $$;
revoke all on function public.execute_inventory_import(jsonb,uuid,uuid,uuid,text,boolean) from public,anon,authenticated;

create function public.preview_inventory_import(p_payload jsonb,p_site uuid,p_location uuid,p_container uuid,p_reference text,p_filename text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; draft_id uuid;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede importar'; end if;
  perform pg_advisory_xact_lock(90714001);
  if exists(select 1 from public.inventory_import_drafts where headquarters_id=p_site and lower(reference)=lower(trim(p_reference)) and imported_at is not null) then raise exception 'Esta referencia de carga ya se ha importado en la sede. Para otra entrega utiliza una referencia diferente'; end if;
  result=public.execute_inventory_import(p_payload,p_site,p_location,p_container,trim(p_reference),true);
  insert into public.inventory_import_drafts(filename,reference,headquarters_id,location_id,container_id,payload,plan)
    values(p_filename,trim(p_reference),p_site,p_location,p_container,p_payload,result) returning id into draft_id;
  return jsonb_build_object('draftId',draft_id,'plan',result);
end $$;
create function public.confirm_inventory_import(p_draft uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare draft public.inventory_import_drafts; result jsonb;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede importar'; end if;
  perform pg_advisory_xact_lock(90714001);
  select * into draft from public.inventory_import_drafts where id=p_draft and created_by=auth.uid() for update;
  if not found then raise exception 'Vista previa no disponible'; end if;
  if draft.imported_at is not null then return draft.plan; end if;
  if draft.created_at<now()-interval '7 days' then raise exception 'La vista previa ha caducado. Vuelve a revisar el archivo'; end if;
  if exists(select 1 from public.inventory_import_drafts where headquarters_id=draft.headquarters_id and lower(reference)=lower(draft.reference) and imported_at is not null) then raise exception 'Esta referencia de carga ya se ha importado. No se duplica el stock'; end if;
  result=public.execute_inventory_import(draft.payload,draft.headquarters_id,draft.location_id,draft.container_id,draft.reference,false);
  if result is distinct from draft.plan then raise exception 'El catalogo o las existencias han cambiado desde la revision. No se ha importado nada: vuelve a generar la vista previa'; end if;
  update public.inventory_import_drafts set imported_at=now() where id=p_draft;
  return result;
end $$;
revoke all on function public.preview_inventory_import(jsonb,uuid,uuid,uuid,text,text),public.confirm_inventory_import(uuid) from public,anon,authenticated;
grant execute on function public.preview_inventory_import(jsonb,uuid,uuid,uuid,text,text),public.confirm_inventory_import(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
