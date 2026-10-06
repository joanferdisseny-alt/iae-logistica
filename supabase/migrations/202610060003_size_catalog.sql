begin;

-- Garment templates created by the uniformity importer identify a product, not
-- a generic category. Keep item IDs as stock variants so existing QR codes,
-- deliveries, barcodes and stock history remain valid. Never group by name.
create or replace view public.inventory_catalog_items
with (security_invoker = true) as
with classified as (
  select i.*, t.name as garment_name,
    coalesce(t.code ~ '^uniformidad_[a-f0-9]{32}$'
      and nullif(btrim(i.technical_specs->>'uniformidad_talla'), '') is not null, false) as is_size_group
  from public.inventory_items i
  left join public.inventory_templates t on t.id=i.template_id
), grouped as (
  select
    (array_agg(id order by created_at, id))[1] as id,
    array_agg(id order by created_at, id) as item_ids,
    case when is_size_group then max(garment_name) else max(name) end as name,
    headquarters_id, category, unit, is_size_group,
    case when is_size_group then count(distinct technical_specs->>'uniformidad_talla') else 0 end as size_count,
    string_agg(name, ' ') as search_names,
    max(subtype) as subtype,
    sum(current_stock) as current_stock,
    sum(minimum_stock) as minimum_stock,
    case when bool_or(status='low') then 'low'
      when bool_or(status='maintenance') then 'maintenance' else 'ok' end as base_status,
    min(expiration_date) filter (where current_stock>0) as expiration_date,
    min(maintenance_due_at) as maintenance_due_at,
    case when count(distinct operational_status)=1 then max(operational_status) else 'mixed' end as operational_status,
    array_agg(distinct operational_status) as operational_statuses,
    max(created_at) as created_at,
    jsonb_agg(jsonb_build_object('id',id,'name',name,'size',technical_specs->>'uniformidad_talla',
      'quantity',current_stock,'status',status,'expiration_date',expiration_date,
      'operational_status',operational_status) order by created_at,id) as variants
  from classified
  group by case when is_size_group then template_id else id end,
    headquarters_id, category, unit, is_size_group
)
select id,item_ids,name,headquarters_id,category,unit,is_size_group,size_count,
  name || ' ' || search_names as search_text,subtype,current_stock,minimum_stock,
  case when expiration_date < (now() at time zone 'Europe/Madrid')::date then 'expired'
    else base_status end as status,
  expiration_date,maintenance_due_at,operational_status,operational_statuses,created_at,variants
from grouped;

revoke all on public.inventory_catalog_items from public,anon,authenticated;
grant select on public.inventory_catalog_items to authenticated;
comment on view public.inventory_catalog_items is
  'RLS-preserving catalogue: one garment per headquarters/category/unit, with item IDs retained as size variants. No stock mutation.';
notify pgrst, 'reload schema';
commit;
