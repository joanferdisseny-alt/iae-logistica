begin;

alter table public.logistics_requests
  add column if not exists item_id uuid references public.inventory_items(id) on delete restrict;
create index if not exists logistics_requests_item_idx on public.logistics_requests(item_id)
  where item_id is not null;
grant insert (item_id) on public.logistics_requests to authenticated;

-- Store a stable label/unit snapshot, but keep a real link to the source article.
create or replace function public.guard_logistics_request_article()
returns trigger language plpgsql security definer set search_path = public as $$
declare article public.inventory_items%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.item_id is distinct from old.item_id then
      raise exception 'La referencia de una solicitud no se puede cambiar' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.item_id is null then return new; end if;
  if public.user_role() is null or not coalesce(public.user_role()='admin'
    or new.headquarters_id=public.user_headquarters_id(), false) then
    raise exception 'Articulo no disponible en esta sede' using errcode = '42501';
  end if;
  select * into article from public.inventory_items
    where id=new.item_id and headquarters_id=new.headquarters_id for share;
  if not found then
    raise exception 'Articulo no disponible en esta sede' using errcode = '23514';
  end if;
  new.material=left(article.name,160);
  new.unit=left(coalesce(nullif(trim(article.unit),''),'unidades'),40);
  return new;
end $$;
drop trigger if exists guard_logistics_request_article on public.logistics_requests;
create trigger guard_logistics_request_article before insert or update of item_id on public.logistics_requests
for each row execute function public.guard_logistics_request_article();
revoke all on function public.guard_logistics_request_article() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
