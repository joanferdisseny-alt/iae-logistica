begin;

-- Depends on 202609140001: active-user helpers and is_logistics_contact.
create function public.can_manage_logistics_requests(p_headquarters_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(public.user_role() = 'admin' or (
    public.user_role() is not null
    and p_headquarters_id = public.user_headquarters_id()
    and exists (select 1 from public.profiles p
      where p.id = auth.uid() and p.is_active and p.is_logistics_contact)
  ), false)
$$;
revoke all on function public.can_manage_logistics_requests(uuid) from public, anon;
grant execute on function public.can_manage_logistics_requests(uuid) to authenticated;

create table public.logistics_requests (
  id uuid primary key default gen_random_uuid(),
  headquarters_id uuid not null references public.headquarters(id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  material text not null check (char_length(trim(material)) between 2 and 160),
  quantity numeric not null check (
    quantity > 0 and quantity <= 999999999.999 and quantity = round(quantity, 3)
  ),
  unit text not null default 'unidades' check (char_length(trim(unit)) between 1 and 40),
  notes text not null default '' check (char_length(notes) <= 2000),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'preparing', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index logistics_requests_site_status_idx
  on public.logistics_requests(headquarters_id, status, created_at desc);
create index logistics_requests_author_idx
  on public.logistics_requests(created_by, created_at desc);

create table public.logistics_request_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.logistics_requests(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  from_status text check (from_status in ('pending', 'accepted', 'preparing', 'completed', 'cancelled')),
  to_status text not null check (to_status in ('pending', 'accepted', 'preparing', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);
create index logistics_request_history_request_idx
  on public.logistics_request_history(request_id, created_at);

alter table public.logistics_requests enable row level security;
alter table public.logistics_request_history enable row level security;

create policy logistics_requests_read on public.logistics_requests
for select to authenticated using (
  public.can_manage_logistics_requests(headquarters_id)
  or (public.user_role() is not null and created_by = auth.uid()
    and headquarters_id = public.user_headquarters_id())
);
create policy logistics_requests_create on public.logistics_requests
for insert to authenticated with check (
  public.user_role() is not null and created_by = auth.uid() and status = 'pending'
  and (public.user_role() = 'admin' or headquarters_id = public.user_headquarters_id())
  and exists (select 1 from public.headquarters h where h.id = headquarters_id and h.is_active)
);
create policy logistics_requests_manage on public.logistics_requests
for update to authenticated
using (public.can_manage_logistics_requests(headquarters_id))
with check (public.can_manage_logistics_requests(headquarters_id));
create policy logistics_requests_cancel_own on public.logistics_requests
for update to authenticated
using (public.user_role() is not null and created_by = auth.uid()
  and headquarters_id = public.user_headquarters_id() and status = 'pending')
with check (public.user_role() is not null and created_by = auth.uid()
  and headquarters_id = public.user_headquarters_id() and status = 'cancelled');
create policy logistics_request_history_read on public.logistics_request_history
for select to authenticated using (
  exists (select 1 from public.logistics_requests r where r.id = request_id)
);

-- Column grants prevent changing ownership, site, timestamps or request contents.
revoke all on public.logistics_requests, public.logistics_request_history from public, anon, authenticated;
grant select on public.logistics_requests, public.logistics_request_history to authenticated;
grant insert (headquarters_id, material, quantity, unit, notes) on public.logistics_requests to authenticated;
grant update (status) on public.logistics_requests to authenticated;

create function public.guard_logistics_request_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if not (
    (old.status = 'pending' and new.status in ('accepted', 'cancelled')) or
    (old.status = 'accepted' and new.status in ('preparing', 'cancelled')) or
    (old.status = 'preparing' and new.status in ('completed', 'cancelled'))
  ) or new.status is null then
    raise exception 'Transicion de solicitud no permitida' using errcode = '23514';
  end if;
  new.updated_at = clock_timestamp();
  return new;
end $$;
create trigger guard_logistics_request_status before update on public.logistics_requests
for each row execute function public.guard_logistics_request_status();

-- History is written atomically by the database, never by a client or mail job.
create function public.record_logistics_request_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.logistics_request_history(request_id, actor_id, from_status, to_status)
    values (new.id, auth.uid(), null, new.status);
  elsif new.status is distinct from old.status then
    insert into public.logistics_request_history(request_id, actor_id, from_status, to_status)
    values (new.id, auth.uid(), old.status, new.status);
  end if;
  return new;
end $$;
create trigger record_logistics_request_history after insert or update on public.logistics_requests
for each row execute function public.record_logistics_request_history();
revoke all on function public.guard_logistics_request_status() from public, anon, authenticated;
revoke all on function public.record_logistics_request_history() from public, anon, authenticated;

commit;
