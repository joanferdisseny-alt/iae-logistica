begin;

alter table public.inventory_categories
  add column if not exists parent_code text references public.inventory_categories(code) on delete restrict;
create index if not exists inventory_categories_parent_idx on public.inventory_categories(parent_code);

create or replace function public.guard_category_parent() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(90714001);
  if new.parent_code=new.code or (new.parent_code is not null and exists(with recursive parents as (
    select code,parent_code from public.inventory_categories where code=new.parent_code
    union select c.code,c.parent_code from public.inventory_categories c join parents p on c.code=p.parent_code
  ) select 1 from parents where code=new.code)) then
    raise exception 'Una categoria no puede depender de si misma ni de una de sus subcategorias'
      using errcode='23514';
  end if;
  return new;
end $$;
drop trigger if exists guard_category_parent on public.inventory_categories;
create trigger guard_category_parent before insert or update on public.inventory_categories
for each row execute function public.guard_category_parent();
revoke all on function public.guard_category_parent() from public,anon,authenticated;

commit;
