begin;

-- Preserve user-reviewed provenance in the same transaction as the zero-stock creation.
-- This records a user's source declaration, not independent product verification.
create function public.create_inventory_record_from_product(p_id uuid,p_record jsonb,p_source jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare item uuid; code text; checksum integer;
begin
  if p_id is null or jsonb_typeof(p_record) is distinct from 'object' then raise exception 'Alta de producto no valida'; end if;
  if p_source is null or jsonb_typeof(p_source)<>'object' or length(p_source::text)>512 or
    (select count(*) from jsonb_object_keys(p_source))<>4 or
    coalesce(p_source->>'provider','') not in ('upcitemdb','openfoodfacts') or
    p_source->'reviewed' is distinct from 'true'::jsonb or
    jsonb_typeof(p_source->'code') is distinct from 'string' or
    jsonb_typeof(p_source->'fetchedAt') is distinct from 'string' then
    raise exception 'Fuente revisada no valida';
  end if;
  code=p_source->>'code';
  if code !~ '^(\d{8}|\d{12}|\d{13}|\d{14})$' or code ~ '^0+$' then raise exception 'Codigo de producto no valido'; end if;
  select sum(substr(code,n,1)::integer * case when (length(code)-n)%2=1 then 3 else 1 end)
    into checksum from generate_series(1,length(code)-1) n;
  if (10-checksum%10)%10<>right(code,1)::integer then raise exception 'Codigo de producto no valido'; end if;
  if p_source->>'fetchedAt' !~ '^\d{4}-\d{2}-\d{2}T' then raise exception 'Fecha de consulta no valida'; end if;
  perform (p_source->>'fetchedAt')::timestamptz;
  perform pg_advisory_xact_lock(90714001);
  -- The existing RPC enforces role, site, field validation and exact-payload retries.
  item=public.create_inventory_record_once(p_id,p_record||jsonb_build_object('_online_source',p_source));
  if not exists(select 1 from public.inventory_item_history where item_id=item and event_type='online_product_review') then
    insert into public.inventory_item_history(item_id,actor_id,event_type,details)
      values(item,auth.uid(),'online_product_review',jsonb_build_object('source',p_source));
  end if;
  return item;
end $$;

revoke execute on function public.create_inventory_record_from_product(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_inventory_record_from_product(uuid,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
