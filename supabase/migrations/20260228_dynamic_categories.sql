create table if not exists public.inventory_categories (
  code text primary key,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

insert into public.inventory_categories (code, name, description)
values
  ('tool', 'Herramienta', 'Herramientas operativas y eléctricas.'),
  ('material', 'Material', 'Material técnico y reutilizable.'),
  ('food', 'Comida', 'Alimentos y productos con caducidad.'),
  ('consumable', 'Consumible', 'Elementos fungibles y de reposición.')
on conflict (code) do nothing;

alter table public.inventory_templates
  add column if not exists category_code text;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='inventory_templates' and column_name='category') then
    execute 'update public.inventory_templates set category_code=category where category_code is null';
  end if;
end $$;

alter table public.inventory_templates
  alter column category_code set not null;

alter table public.inventory_templates
  drop constraint if exists inventory_templates_category_check;

alter table public.inventory_templates
  drop column if exists category;

alter table public.inventory_templates
  drop constraint if exists inventory_templates_category_code_fkey;
alter table public.inventory_templates
  add constraint inventory_templates_category_code_fkey
  foreign key (category_code) references public.inventory_categories (code);

alter table public.inventory_items
  drop constraint if exists inventory_items_category_check;

alter table public.inventory_items
  drop constraint if exists inventory_items_category_fkey;
alter table public.inventory_items
  add constraint inventory_items_category_fkey
  foreign key (category) references public.inventory_categories (code);

alter table public.inventory_categories enable row level security;

drop policy if exists "Categories readable by authenticated users" on public.inventory_categories;
create policy "Categories readable by authenticated users"
on public.inventory_categories
for select
to authenticated
using (true);

drop policy if exists "Admins manage categories" on public.inventory_categories;
create policy "Admins manage categories"
on public.inventory_categories
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');
