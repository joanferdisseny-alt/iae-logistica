create table if not exists public.inventory_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category_code text not null references public.inventory_categories (code),
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_template_fields (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.inventory_templates (id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'date', 'textarea', 'select', 'boolean')),
  is_required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  unique (template_id, field_key)
);

alter table public.inventory_items
add column if not exists template_id uuid references public.inventory_templates (id);

create table if not exists public.inventory_item_relations (
  id uuid primary key default gen_random_uuid(),
  source_item_id uuid not null references public.inventory_items (id) on delete cascade,
  target_item_id uuid not null references public.inventory_items (id) on delete cascade,
  relation_type text not null check (relation_type in ('uses', 'requires', 'compatible_with')),
  quantity_required integer,
  notes text,
  created_at timestamptz not null default now(),
  unique (source_item_id, target_item_id, relation_type)
);

alter table public.inventory_templates enable row level security;
alter table public.inventory_template_fields enable row level security;
alter table public.inventory_item_relations enable row level security;

drop policy if exists "Templates readable by authenticated users" on public.inventory_templates;
create policy "Templates readable by authenticated users"
on public.inventory_templates
for select
to authenticated
using (true);

drop policy if exists "Template fields readable by authenticated users" on public.inventory_template_fields;
create policy "Template fields readable by authenticated users"
on public.inventory_template_fields
for select
to authenticated
using (true);

drop policy if exists "Relations readable by authenticated users" on public.inventory_item_relations;
create policy "Relations readable by authenticated users"
on public.inventory_item_relations
for select
to authenticated
using (true);

drop policy if exists "Admins and operators manage relations" on public.inventory_item_relations;
create policy "Admins and operators manage relations"
on public.inventory_item_relations
for all
to authenticated
using (public.user_role() in ('admin', 'operator'))
with check (public.user_role() in ('admin', 'operator'));

insert into public.inventory_templates (code, name, category_code, description)
values
  ('tool_drill', 'Taladro / herramienta eléctrica', 'tool', 'Ficha técnica para herramientas eléctricas con potencia y compatibilidades.'),
  ('consumable_drill_bits', 'Brocas / consumible asociado', 'consumable', 'Consumibles compatibles con herramientas, con medida y material.'),
  ('material_rescue_kit', 'Material de rescate', 'material', 'Material técnico con certificación o especificaciones operativas.'),
  ('food_animal_feed', 'Comida / pienso', 'food', 'Ficha de alimentos con lote, especie y formato.')
on conflict (code) do nothing;

insert into public.inventory_template_fields (template_id, field_key, label, field_type, is_required, options, sort_order)
select t.id, x.field_key, x.label, x.field_type, x.is_required, x.options::jsonb, x.sort_order
from public.inventory_templates t
join (
  values
    ('tool_drill', 'brand', 'Marca', 'text', true, '[]', 1),
    ('tool_drill', 'model', 'Modelo', 'text', true, '[]', 2),
    ('tool_drill', 'power', 'Potencia', 'text', false, '[]', 3),
    ('tool_drill', 'power_source', 'Alimentación', 'select', false, '["battery","mains","fuel"]', 4),
    ('tool_drill', 'chuck_size', 'Portabrocas', 'text', false, '[]', 5),
    ('consumable_drill_bits', 'diameter', 'Diámetro', 'text', true, '[]', 1),
    ('consumable_drill_bits', 'material', 'Material', 'select', false, '["steel","wood","concrete","mixed"]', 2),
    ('consumable_drill_bits', 'format', 'Formato', 'text', false, '[]', 3),
    ('material_rescue_kit', 'brand', 'Marca', 'text', false, '[]', 1),
    ('material_rescue_kit', 'model', 'Modelo', 'text', false, '[]', 2),
    ('material_rescue_kit', 'standard', 'Normativa', 'text', false, '[]', 3),
    ('material_rescue_kit', 'size', 'Talla / medida', 'text', false, '[]', 4),
    ('food_animal_feed', 'lot', 'Lote', 'text', true, '[]', 1),
    ('food_animal_feed', 'species', 'Especie', 'select', true, '["dog","cat","mixed"]', 2),
    ('food_animal_feed', 'format', 'Formato', 'text', false, '[]', 3),
    ('food_animal_feed', 'supplier', 'Proveedor', 'text', false, '[]', 4)
) as x(template_code, field_key, label, field_type, is_required, options, sort_order)
on t.code = x.template_code
on conflict (template_id, field_key) do nothing;
