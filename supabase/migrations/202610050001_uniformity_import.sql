begin;

alter table public.inventory_template_fields add column allowed_options jsonb
  check(allowed_options is null or jsonb_typeof(allowed_options)='array');
create or replace function public.validate_inventory_fields() returns trigger
language plpgsql security definer set search_path='' as $$
declare f record; values_json jsonb; val text;
begin
  if new.template_id is null then return new; end if;
  if new.category is distinct from (select category_code from public.inventory_templates where id=new.template_id) then raise exception 'Categoria y plantilla no coinciden'; end if;
  values_json=coalesce(new.technical_specs,'{}'::jsonb) || jsonb_build_object(
    'item_name',new.name,'name',new.name,'description',new.description,'subtype',new.subtype,'sku',new.sku,'serial_number',new.serial_number,
    'current_stock',new.current_stock,'minimum_stock',new.minimum_stock,'unit',new.unit,'expiration_date',new.expiration_date,
    'maintenance_due_at',new.maintenance_due_at,'location_id',new.location_id,'lot_code',new.lot_code,'is_consumable',new.is_consumable);
  for f in select d.field_key,d.field_type,d.options,a.allowed_options,a.is_required from public.inventory_template_fields a join public.inventory_fields d on d.id=a.field_id where a.template_id=new.template_id loop
    val=values_json->>f.field_key;
    if f.is_required and f.field_type<>'boolean' and (val is null or trim(val)='') then raise exception 'Falta campo obligatorio: %',f.field_key; end if;
    if val is null or val='' then continue; end if;
    if f.field_type='number' and val !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'Numero invalido: %',f.field_key; end if;
    if f.field_type='date' then perform val::date; end if;
    if f.field_type='boolean' and val not in ('true','false') then raise exception 'Booleano invalido: %',f.field_key; end if;
    if f.field_type='select' and (not (f.options ? val) or (f.allowed_options is not null and not f.allowed_options ? val)) then raise exception 'Opcion no disponible en esta ficha: %',f.field_key; end if;
  end loop;
  return new;
end $$;

create table public.uniformity_import_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references public.profiles(id),
  filename text not null check(length(filename) between 1 and 200),
  file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
  rows jsonb not null check(jsonb_typeof(rows)='array' and jsonb_array_length(rows) between 1 and 2000),
  created_at timestamptz not null default now()
);
create table public.uniformity_imports (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references public.uniformity_import_drafts(id),
  headquarters_id uuid not null references public.headquarters(id),
  location_id uuid references public.locations(id),
  container_id uuid references public.inventory_containers(id),
  content_hash text not null,
  article_count integer not null,
  total_quantity integer not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(headquarters_id,content_hash)
);
create table public.uniformity_import_lines (
  import_id uuid not null references public.uniformity_imports(id),
  item_id uuid not null unique references public.inventory_items(id),
  source text not null,
  quantity integer not null check(quantity>=0),
  primary key(import_id,item_id)
);
alter table public.uniformity_import_drafts enable row level security;
alter table public.uniformity_imports enable row level security;
alter table public.uniformity_import_lines enable row level security;
create policy uniformity_drafts_read on public.uniformity_import_drafts for select to authenticated using(public.user_role()='admin');
create policy uniformity_drafts_create on public.uniformity_import_drafts for insert to authenticated with check(public.user_role()='admin' and created_by=auth.uid());
create policy uniformity_imports_read on public.uniformity_imports for select to authenticated using(public.user_role()='admin');
create policy uniformity_import_lines_read on public.uniformity_import_lines for select to authenticated using(public.user_role()='admin');
revoke all on public.uniformity_import_drafts,public.uniformity_imports,public.uniformity_import_lines from public,anon,authenticated;
grant select on public.uniformity_import_drafts,public.uniformity_imports,public.uniformity_import_lines to authenticated;
grant insert(filename,file_hash,rows) on public.uniformity_import_drafts to authenticated;

create function public.import_uniformity_stock(p_draft_id uuid,p_headquarters_id uuid,p_location_id uuid default null,p_container_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare draft public.uniformity_import_drafts; batch public.uniformity_imports; entry jsonb; clean jsonb; fingerprint text; sizes jsonb;
  v_category_code text; v_template_code text; garment text; size text; amount integer; article uuid; template uuid; v_sku text; import_id uuid;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede importar'; end if;
  perform pg_advisory_xact_lock(90714001);
  select * into draft from public.uniformity_import_drafts where id=p_draft_id and created_by=auth.uid();
  if not found then raise exception 'Vista previa no disponible. Analiza el archivo otra vez'; end if;
  select * into batch from public.uniformity_imports where draft_id=p_draft_id;
  if found then
    if batch.headquarters_id<>p_headquarters_id then raise exception 'Esta vista previa ya se importo en otra sede'; end if;
    if batch.location_id is distinct from p_location_id or batch.container_id is distinct from p_container_id then raise exception 'Esta vista previa ya se importo en otro destino. No se modifica la carga anterior'; end if;
    return batch.id;
  end if;
  if not exists(select 1 from public.headquarters where id=p_headquarters_id and is_active) then raise exception 'Sede no disponible'; end if;
  if p_location_id is not null and p_container_id is not null then raise exception 'Elige ubicacion o caja, no ambas'; end if;
  if p_location_id is not null and not exists(select 1 from public.locations where id=p_location_id and headquarters_id=p_headquarters_id and is_active) then raise exception 'Ubicacion no disponible en esta sede'; end if;
  if p_container_id is not null and not exists(select 1 from public.inventory_containers where id=p_container_id and headquarters_id=p_headquarters_id and is_active) then raise exception 'Caja no disponible en esta sede'; end if;
  if exists(select 1 from jsonb_array_elements(draft.rows) e where
    coalesce(e->>'section','') not in ('first','second') or length(trim(coalesce(e->>'garment',''))) not between 2 and 120 or
    coalesce(e->>'size','') not in ('XS','S','M','L','XL','XXL','SIN TALLA') or coalesce(e->>'quantity','') !~ '^[0-9]{1,7}$' or
    length(coalesce(e->>'source','')) not between 1 and 200) then raise exception 'Filas de importacion no validas'; end if;
  if exists(select 1 from jsonb_array_elements(draft.rows) e where (e->>'quantity')::integer>1000000) then raise exception 'Cantidad excesiva'; end if;
  if exists(select 1 from jsonb_array_elements(draft.rows) e group by e->>'section',e->>'garment',e->>'size' having count(*)>1) then raise exception 'Hay prendas y tallas duplicadas'; end if;
  select jsonb_agg(jsonb_build_object('section',e->>'section','garment',e->>'garment','size',e->>'size','quantity',(e->>'quantity')::integer)
    order by e->>'section',e->>'garment',e->>'size') into clean from jsonb_array_elements(draft.rows) e;
  fingerprint=md5(clean::text);
  select * into batch from public.uniformity_imports where headquarters_id=p_headquarters_id and content_hash=fingerprint;
  if found then
    if batch.location_id is distinct from p_location_id or batch.container_id is distinct from p_container_id then raise exception 'Este contenido ya se importo en otro destino. Usa movimientos para trasladar el stock'; end if;
    return batch.id;
  end if;

  insert into public.inventory_categories(code,name,parent_code) values('uniformidad','Uniformidad',null) on conflict(code) do nothing;
  insert into public.inventory_categories(code,name,parent_code) values
    ('uniformidad_primera','Primera uniformidad','uniformidad'),('uniformidad_segunda','Segunda uniformidad','uniformidad') on conflict(code) do nothing;
  if exists(select 1 from public.inventory_categories where (code='uniformidad' and parent_code is not null)
    or (code in ('uniformidad_primera','uniformidad_segunda') and parent_code is distinct from 'uniformidad')) then raise exception 'Las categorias existentes no coinciden con Uniformidad'; end if;
  insert into public.inventory_fields(field_key,label,field_type,options) values
    ('name','Nombre del articulo','text','[]'),('uniformidad_talla','Talla','select','["XS","S","M","L","XL","XXL","SIN TALLA"]'),
    ('current_stock','Stock inicial','number','[]') on conflict(field_key) do nothing;
  if exists(select 1 from public.inventory_fields where (field_key='name' and field_type<>'text') or
    (field_key='current_stock' and field_type<>'number') or (field_key='uniformidad_talla' and (field_type<>'select' or not options @> '["XS","S","M","L","XL","XXL","SIN TALLA"]'::jsonb))) then raise exception 'Los campos existentes son incompatibles con la importacion'; end if;
  insert into public.uniformity_imports(draft_id,headquarters_id,location_id,container_id,content_hash,article_count,total_quantity,created_by)
    select p_draft_id,p_headquarters_id,p_location_id,p_container_id,fingerprint,jsonb_array_length(clean),sum((e->>'quantity')::integer),auth.uid() from jsonb_array_elements(clean) e returning id into import_id;
  for entry in select * from jsonb_array_elements(draft.rows) loop
    garment=entry->>'garment'; size=entry->>'size'; amount=(entry->>'quantity')::integer;
    v_category_code=case when entry->>'section'='first' then 'uniformidad_primera' else 'uniformidad_segunda' end;
    v_template_code='uniformidad_'||md5((entry->>'section')||'|'||garment);
    v_sku='UNI-'||md5((entry->>'section')||'|'||garment||'|'||size);
    if exists(select 1 from public.inventory_items i where i.headquarters_id=p_headquarters_id and i.sku=v_sku) then
      raise exception 'Ya existe % talla % en esta sede. No se sobreescribe ni se suma stock; usa movimientos para actualizarlo',garment,size;
    end if;
    insert into public.inventory_templates(code,name,category_code,description) values(v_template_code,garment,v_category_code,'Uniformidad importada; existencias independientes por talla') on conflict(code) do nothing;
    select id into template from public.inventory_templates t where t.code=v_template_code and t.category_code=v_category_code;
    if template is null then raise exception 'La ficha existente tiene una categoria diferente'; end if;
    select jsonb_agg(e->>'size' order by e->>'size') into sizes from jsonb_array_elements(clean) e where e->>'section'=entry->>'section' and e->>'garment'=garment;
    insert into public.inventory_template_fields(template_id,field_id,field_key,label,field_type,options,is_required,sort_order,allowed_options)
      select template,f.id,f.field_key,f.label,f.field_type,f.options,f.field_key<>'current_stock',
        case f.field_key when 'name' then 0 when 'uniformidad_talla' then 1 else 2 end,
        case when f.field_key='uniformidad_talla' then sizes else null end
      from public.inventory_fields f where f.field_key in ('name','uniformidad_talla','current_stock') on conflict(template_id,field_key) do nothing;
    if exists(select 1 from public.inventory_template_fields where template_id=template and field_key='uniformidad_talla' and allowed_options is distinct from sizes) then
      raise exception 'Las tallas de la ficha % han cambiado. Revisa su configuracion antes de importar',garment;
    end if;
    article=public.create_inventory_record(jsonb_build_object('name',garment||' · '||size,'slug','uniformidad-'||p_headquarters_id||'-'||lower(v_sku),
      'template_id',template,'headquarters_id',p_headquarters_id,'location_id',p_location_id,'sku',v_sku,'unit','unidades',
      'current_stock',amount,'technical_specs',jsonb_build_object('uniformidad_talla',size),'lot_code','Carga inicial'),p_container_id,amount,'Importacion inicial de uniformidad');
    insert into public.uniformity_import_lines(import_id,item_id,source,quantity) values(import_id,article,entry->>'source',amount);
  end loop;
  return import_id;
end $$;
revoke all on function public.import_uniformity_stock(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.import_uniformity_stock(uuid,uuid,uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
