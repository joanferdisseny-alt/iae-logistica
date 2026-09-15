begin;
alter table public.inventory_attachments add column if not exists storage_path text;
alter table public.inventory_attachments alter column url drop not null;
alter table public.inventory_attachments drop constraint if exists attachment_source;
alter table public.inventory_attachments add constraint attachment_source check ((url is null) <> (storage_path is null));
create unique index if not exists attachment_storage_path_idx on public.inventory_attachments(storage_path);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('inventory-documents','inventory-documents',false,4194304,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Admins upload inventory documents" on storage.objects;
create policy "Admins upload inventory documents" on storage.objects for insert to authenticated
with check(bucket_id='inventory-documents' and public.user_role()='admin');
drop policy if exists "Admins delete inventory documents" on storage.objects;
create policy "Admins delete inventory documents" on storage.objects for delete to authenticated
using(bucket_id='inventory-documents' and public.user_role()='admin');
drop policy if exists "Read visible inventory documents" on storage.objects;
create policy "Read visible inventory documents" on storage.objects for select to authenticated
using(bucket_id='inventory-documents' and exists(select 1 from public.inventory_attachments a where a.storage_path=name));

create or replace function public.validate_inventory_fields() returns trigger
language plpgsql security definer set search_path=public as $$
declare f record; values_json jsonb; val text;
begin
  if new.template_id is null then return new; end if;
  if new.category is distinct from (select category_code from public.inventory_templates where id=new.template_id) then raise exception 'Categoria y plantilla no coinciden'; end if;
  values_json=coalesce(new.technical_specs,'{}'::jsonb) || jsonb_build_object(
    'item_name',new.name,'name',new.name,'description',new.description,'subtype',new.subtype,'sku',new.sku,'serial_number',new.serial_number,
    'current_stock',new.current_stock,'minimum_stock',new.minimum_stock,'unit',new.unit,'expiration_date',new.expiration_date,
    'maintenance_due_at',new.maintenance_due_at,'location_id',new.location_id,'lot_code',new.lot_code,'is_consumable',new.is_consumable);
  for f in select d.field_key,d.field_type,d.options,a.is_required from public.inventory_template_fields a join public.inventory_fields d on d.id=a.field_id where a.template_id=new.template_id loop
    val=values_json->>f.field_key;
    if f.is_required and f.field_type<>'boolean' and (val is null or trim(val)='') then raise exception 'Falta campo obligatorio: %',f.field_key; end if;
    if val is null or val='' then continue; end if;
    if f.field_type='number' and val !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'Numero invalido: %',f.field_key; end if;
    if f.field_type='date' then perform val::date; end if;
    if f.field_type='boolean' and val not in ('true','false') then raise exception 'Booleano invalido: %',f.field_key; end if;
    if f.field_type='select' and not (f.options ? val) then raise exception 'Opcion invalida: %',f.field_key; end if;
  end loop;
  return new;
end $$;
drop trigger if exists validate_inventory_fields on public.inventory_items;
create trigger validate_inventory_fields before insert or update of technical_specs,template_id on public.inventory_items for each row execute function public.validate_inventory_fields();

create or replace function public.update_catalog_field(p_id uuid,p_key text,p_label text,p_type text,p_options jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Sin permiso'; end if;
  update public.inventory_fields set field_key=p_key,label=p_label,field_type=p_type,options=p_options where id=p_id;
  if not found then raise exception 'Campo no encontrado'; end if;
  update public.inventory_template_fields set field_key=p_key,label=p_label,field_type=p_type,options=p_options where field_id=p_id;
end $$;
revoke all on function public.update_catalog_field(uuid,text,text,text,jsonb) from public;
grant execute on function public.update_catalog_field(uuid,text,text,text,jsonb) to authenticated;

create or replace function public.protect_occupied_container() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(90714001);
  if exists(select 1 from public.inventory_container_items where container_id=old.id) then
    raise exception 'No se puede borrar una caja con articulos';
  end if;
  return old;
end $$;
drop trigger if exists protect_occupied_container on public.inventory_containers;
create trigger protect_occupied_container before delete on public.inventory_containers for each row execute function public.protect_occupied_container();

create or replace function public.sync_template_category() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.category_code is distinct from old.category_code then
    update public.inventory_items set category=new.category_code where template_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists sync_template_category on public.inventory_templates;
create trigger sync_template_category after update of category_code on public.inventory_templates for each row execute function public.sync_template_category();
commit;
