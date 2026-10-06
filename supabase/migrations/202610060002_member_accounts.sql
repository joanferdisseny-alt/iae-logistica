begin;

-- Administrators may have global access without a home headquarters.
alter table public.volunteers alter column headquarters_id drop not null;
create index volunteers_email_lookup on public.volunteers(lower(trim(email)));
create index volunteers_email_exact on public.volunteers(email);

create table public.member_imports (
  id uuid primary key,
  created_by uuid not null references public.profiles(id),
  filename text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create table public.member_provision_requests (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.member_imports(id),
  row_number integer not null,
  email text not null,
  full_name text not null,
  headquarters_id uuid,
  role_code text not null,
  external_code text,
  legacy_volunteer_id uuid,
  is_logistics_contact boolean not null default false,
  profile_id uuid,
  state text not null default 'pending' check(state in ('pending','created','existing')),
  mail_status text not null default 'pending' check(mail_status in ('pending','sent','failed','not_needed')),
  last_error text,
  lease uuid,
  leased_until timestamptz,
  updated_at timestamptz not null default now(),
  unique(batch_id,email), unique(batch_id,row_number)
);
alter table public.member_imports enable row level security;
alter table public.member_provision_requests enable row level security;
create policy member_imports_read on public.member_imports for select to authenticated using(public.user_role()='admin' and created_by=auth.uid());
create policy member_requests_read on public.member_provision_requests for select to authenticated using(public.user_role()='admin' and exists(select 1 from public.member_imports b where b.id=batch_id and b.created_by=auth.uid()));
revoke all on public.member_imports,public.member_provision_requests from public,anon,authenticated;
grant select on public.member_imports,public.member_provision_requests to authenticated;

create function public.sync_profile_volunteer() returns trigger
language plpgsql security definer set search_path='' as $$
declare v public.volunteers; email_address text; legacy_ids uuid[]; request public.member_provision_requests; code text; member_name text;
begin
  select lower(trim(u.email)) into email_address from auth.users u where u.id=new.id;
  member_name=left(coalesce(nullif(trim(new.full_name),''),email_address,'Voluntario'),160);
  if length(member_name)<2 then member_name='Voluntario '||member_name; end if;
  select * into v from public.volunteers where profile_id=new.id;
  if v.id is null then
    select r.* into request from public.member_provision_requests r join auth.users u on u.id=new.id
      where r.id::text=to_jsonb(u)->'raw_app_meta_data'->>'iae_provision_request' and r.email=email_address and r.profile_id is null;
    if request.legacy_volunteer_id is not null then
      select * into v from public.volunteers where id=request.legacy_volunteer_id and profile_id is null for update;
      if not found then raise exception 'La ficha antigua ya tiene otra cuenta. Revisa el alta'; end if;
    else
      select array_agg(id order by id) into legacy_ids from public.volunteers
        where profile_id is null and email_address is not null and lower(trim(email))=email_address and headquarters_id is not distinct from new.headquarters_id;
      if cardinality(legacy_ids)=1 then select * into v from public.volunteers where id=legacy_ids[1] for update; end if;
    end if;
    code=coalesce(request.external_code,'VOL-'||new.id::text);
    if v.id is null then
      insert into public.volunteers(external_code,full_name,email,headquarters_id,profile_id,is_active)
      values(code,member_name,email_address,new.headquarters_id,new.id,new.is_active);
      return new;
    end if;
  end if;
  update public.volunteers set profile_id=new.id,full_name=member_name,
    email=email_address,headquarters_id=new.headquarters_id,is_active=new.is_active where id=v.id;
  return new;
end $$;
create trigger sync_profile_volunteer after insert or update of full_name,headquarters_id,is_active on public.profiles
for each row execute function public.sync_profile_volunteer();
revoke all on function public.sync_profile_volunteer() from public,anon,authenticated;

-- Reconcile existing accounts without inventing emails or losing historical deliveries.
update public.profiles set full_name=full_name;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare request public.member_provision_requests; role uuid;
begin
  select * into request from public.member_provision_requests
    where id::text=to_jsonb(new)->'raw_app_meta_data'->>'iae_provision_request' and email=lower(trim(new.email)) and profile_id is null;
  if request.id is not null then
    if (request.headquarters_id is null and request.role_code<>'admin') or (request.headquarters_id is not null and not exists(select 1 from public.headquarters where id=request.headquarters_id and is_active)) then raise exception 'Sede no disponible para el alta'; end if;
    select id into role from public.app_roles where code=request.role_code;
  else
    -- User-editable metadata never supplies roles or headquarters.
    select id into role from public.app_roles where code='volunteer';
  end if;
  insert into public.profiles(id,full_name,role_id,headquarters_id,is_active,is_logistics_contact)
    values(new.id,coalesce(request.full_name,left(coalesce(new.raw_user_meta_data->>'full_name',new.email,'Voluntario'),160)),role,
      request.headquarters_id,true,coalesce(request.is_logistics_contact,false));
  if request.id is not null then
    update public.member_provision_requests set profile_id=new.id,state='created',updated_at=now() where id=request.id;
  end if;
  return new;
end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

create function public.sync_member_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.email is distinct from old.email then
    update public.volunteers set email=lower(trim(new.email)) where profile_id=new.id;
  end if;
  return new;
end $$;
create trigger sync_member_email after update of email on auth.users for each row execute function public.sync_member_email();
revoke all on function public.sync_member_email() from public,anon,authenticated;

-- Changing name/base site in either screen changes the same person. Account links
-- cannot be removed or reassigned through the old volunteer creation RPC.
create or replace function public.save_volunteer(p_id uuid,p_code text,p_name text,p_email text,p_headquarters_id uuid,p_profile_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.volunteers; profile public.profiles; result uuid; account_email text;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede gestionar voluntarios'; end if;
  perform pg_advisory_xact_lock(90714002);
  if p_id is not null then select * into v from public.volunteers where id=p_id;
  elsif p_profile_id is not null then select * into v from public.volunteers where profile_id=p_profile_id; end if;
  if v.id is null or v.profile_id is null then raise exception 'Crea la cuenta con correo y codigo de activacion. No se pueden crear fichas sin usuario'; end if;
  if p_profile_id is not null and p_profile_id<>v.profile_id then raise exception 'No se puede cambiar la cuenta de una ficha'; end if;
  select * into profile from public.profiles where id=v.profile_id;
  if p_id is null and profile.headquarters_id is distinct from p_headquarters_id and not exists(select 1 from public.app_roles where id=profile.role_id and code='admin') then raise exception 'El usuario no pertenece a esta sede'; end if;
  if p_headquarters_id is not null and not exists(select 1 from public.headquarters where id=p_headquarters_id and is_active) then raise exception 'Sede no disponible'; end if;
  if p_headquarters_id is null and not exists(select 1 from public.app_roles where id=profile.role_id and code='admin') then raise exception 'Asigna una sede al voluntario'; end if;
  select lower(trim(email)) into account_email from auth.users where id=v.profile_id;
  if nullif(trim(p_email),'') is not null and lower(trim(p_email)) is distinct from account_email then raise exception 'El correo debe ser el de la cuenta de acceso'; end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 160 or length(trim(coalesce(p_code,''))) not between 1 and 80 then raise exception 'Revisa nombre y codigo'; end if;
  update public.volunteers set external_code=trim(p_code) where id=v.id;
  update public.profiles set full_name=trim(p_name),headquarters_id=p_headquarters_id where id=v.profile_id;
  return v.id;
end $$;

create function public.preview_member_accounts(p_emails jsonb) returns table(email text,existing boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede revisar usuarios'; end if;
  if jsonb_typeof(p_emails) is distinct from 'array' then raise exception 'Correos no validos'; end if;
  if jsonb_array_length(p_emails) not between 1 and 500 or octet_length(p_emails::text)>140000 then raise exception 'Maximo 500 correos'; end if;
  return query select lower(trim(e.value)),exists(select 1 from auth.users u where lower(trim(u.email))=lower(trim(e.value)))
    from jsonb_array_elements_text(p_emails) e(value);
end $$;
revoke all on function public.preview_member_accounts(jsonb) from public,anon,authenticated;
grant execute on function public.preview_member_accounts(jsonb) to authenticated;

create function public.prepare_member_accounts(p_id uuid,p_filename text,p_rows jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare r jsonb; n integer=0; email_address text; ids uuid[]; account_id uuid; legacy public.volunteers; site uuid; role text; code text; existing public.member_imports;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede dar de alta usuarios'; end if;
  perform pg_advisory_xact_lock(90714002);
  select * into existing from public.member_imports where id=p_id;
  if found then
    if existing.created_by<>auth.uid() or existing.payload<>p_rows then raise exception 'Identificador de carga reutilizado'; end if;
    return existing.id;
  end if;
  if p_id is null or length(coalesce(p_filename,'')) not between 1 and 200 or jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Archivo no valido'; end if;
  if jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>600000 then raise exception 'Maximo 500 usuarios por carga'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) e group by lower(trim(e->>'email')) having count(*)>1) then raise exception 'Hay correos repetidos en el archivo'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) e where nullif(trim(e->>'code'),'') is not null group by trim(e->>'code') having count(*)>1) then raise exception 'Hay codigos de voluntario repetidos'; end if;
  insert into public.member_imports(id,created_by,filename,payload) values(p_id,auth.uid(),p_filename,p_rows);
  for r in select * from jsonb_array_elements(p_rows) loop
    n=n+1; legacy=null; account_id=null;
    email_address=lower(trim(r->>'email')); site=nullif(r->>'site','')::uuid; role=coalesce(r->>'role','volunteer'); code=nullif(trim(r->>'code'),'');
    if email_address is null or length(email_address)>254 or email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(trim(coalesce(r->>'name',''))) not between 2 and 160 then raise exception 'Fila %: revisa correo y nombre',n+1; end if;
    if role not in ('admin','editor','reader','volunteer') or (site is null and role<>'admin') or (site is not null and not exists(select 1 from public.headquarters where id=site and is_active)) then raise exception 'Fila %: rol o sede no disponibles',n+1; end if;
    if length(coalesce(code,''))>80 then raise exception 'Fila %: codigo demasiado largo',n+1; end if;
    select array_agg(id) into ids from auth.users where lower(trim(email))=email_address;
    if cardinality(ids)>1 then raise exception 'Fila %: correo ambiguo en Auth',n+1; end if;
    account_id=ids[1];
    if nullif(r->>'volunteer_id','') is not null then
      select * into legacy from public.volunteers where id=(r->>'volunteer_id')::uuid and profile_id is null;
      if not found then raise exception 'Fila %: ficha antigua no disponible',n+1; end if;
    else
      select array_agg(id order by id) into ids from public.volunteers where profile_id is null and (lower(trim(email))=email_address or (code is not null and external_code=code));
      if cardinality(ids)>1 then raise exception 'Fila %: varias fichas antiguas coinciden. Revisa sus correos y codigos',n+1; end if;
      select * into legacy from public.volunteers where id=ids[1];
      if legacy.id is not null and nullif(trim(legacy.email),'') is not null and lower(trim(legacy.email))<>email_address then raise exception 'Fila %: el codigo pertenece a otro correo',n+1; end if;
    end if;
    if legacy.id is not null and legacy.headquarters_id is distinct from site then raise exception 'Fila %: la sede no coincide con la ficha antigua',n+1; end if;
    if code is not null and exists(select 1 from public.volunteers where external_code=code and id is distinct from legacy.id and profile_id is distinct from account_id) then raise exception 'Fila %: codigo ya asignado a otra persona',n+1; end if;
    insert into public.member_provision_requests(batch_id,row_number,email,full_name,headquarters_id,role_code,external_code,legacy_volunteer_id,is_logistics_contact,profile_id,state)
      values(p_id,n+1,email_address,trim(r->>'name'),site,role,coalesce(code,legacy.external_code),legacy.id,role<>'volunteer' and coalesce((r->>'logistics')::boolean,false),account_id,case when account_id is null then 'pending' else 'existing' end);
  end loop;
  return p_id;
end $$;

create function public.claim_member_provision(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.member_provision_requests; owner uuid; account_id uuid; v public.volunteers; legacy public.volunteers; ready boolean; token uuid;
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede dar de alta usuarios'; end if;
  perform pg_advisory_xact_lock(90714002);
  select * into r from public.member_provision_requests where id=p_id for update;
  if not found or not exists(select 1 from public.member_imports where id=r.batch_id and created_by=auth.uid()) then raise exception 'Alta no disponible'; end if;
  if r.mail_status in ('sent','not_needed') then return jsonb_build_object('done',true); end if;
  if r.leased_until>now() then raise exception 'Esta fila se esta procesando. Espera dos minutos antes de reintentar'; end if;
  if r.headquarters_id is not null and not exists(select 1 from public.headquarters where id=r.headquarters_id and is_active) then raise exception 'La sede ya no esta disponible'; end if;
  select id,(coalesce(to_jsonb(u)->>'encrypted_password','')<>'') into account_id,ready from auth.users u where lower(trim(u.email))=r.email;
  if account_id is not null then
    if not exists(select 1 from public.profiles where id=account_id and is_active) then raise exception 'La cuenta esta inactiva. Revisala en Usuarios antes de continuar'; end if;
    select * into v from public.volunteers where profile_id=account_id;
    if r.legacy_volunteer_id is not null and v.id is distinct from r.legacy_volunteer_id then
      select * into legacy from public.volunteers where id=r.legacy_volunteer_id and profile_id is null for update;
      if legacy.id is null or v.headquarters_id is distinct from legacy.headquarters_id then raise exception 'Revisa la cuenta y sede antes de vincular el historial antiguo'; end if;
      update public.volunteer_deliveries set volunteer_id=legacy.id where volunteer_id=v.id;
      delete from public.volunteers where id=v.id;
      update public.volunteers set profile_id=account_id,full_name=v.full_name,email=r.email,is_active=v.is_active where id=legacy.id;
    end if;
    update public.member_provision_requests set profile_id=account_id,state=case when state='created' then state else 'existing' end,
      mail_status=case when ready then 'not_needed' else mail_status end,updated_at=now() where id=r.id;
    if ready then return jsonb_build_object('done',true); end if;
  end if;
  token=gen_random_uuid();
  update public.member_provision_requests set lease=token,leased_until=now()+interval '2 minutes',last_error=null where id=r.id;
  return jsonb_build_object('done',false,'token',token,'email',r.email,'profile_id',account_id,'request_id',r.id);
end $$;
create function public.finish_member_provision(p_id uuid,p_lease uuid,p_sent boolean,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  if public.user_role() is distinct from 'admin' then raise exception 'Solo administracion puede dar de alta usuarios'; end if;
  update public.member_provision_requests r set mail_status=case when p_sent then 'sent' else 'failed' end,last_error=left(p_error,500),lease=null,leased_until=null,updated_at=now()
  where r.id=p_id and r.lease=p_lease and exists(select 1 from public.member_imports b where b.id=r.batch_id and b.created_by=auth.uid());
  if not found then raise exception 'La operacion ha cambiado. Recarga el estado de la importacion'; end if;
end $$;
revoke all on function public.prepare_member_accounts(uuid,text,jsonb),public.claim_member_provision(uuid),public.finish_member_provision(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.prepare_member_accounts(uuid,text,jsonb),public.claim_member_provision(uuid),public.finish_member_provision(uuid,uuid,boolean,text) to authenticated;
notify pgrst, 'reload schema';
commit;
