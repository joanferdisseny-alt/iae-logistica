insert into public.locations (name, description)
values
  ('Base central', 'Almacén principal de la organización.'),
  ('Vehículo 1', 'Material de respuesta inmediata.'),
  ('Cocina', 'Alimentos y consumibles de rotación.')
on conflict do nothing;

insert into public.inventory_items (
  name,
  slug,
  category,
  subtype,
  description,
  technical_specs,
  sku,
  location_id,
  is_consumable,
  minimum_stock,
  current_stock,
  unit,
  expiration_date,
  status
)
select
  'Generador portátil',
  'generador-portatil',
  'tool',
  'energía',
  'Generador para despliegues en operativos nocturnos.',
  '{"power":"2000W","fuel":"gasolina"}'::jsonb,
  'GEN-001',
  l.id,
  false,
  null,
  1,
  'unidad',
  null,
  'ok'
from public.locations l
where l.name = 'Base central'
on conflict (slug) do nothing;

insert into public.inventory_items (
  name,
  slug,
  category,
  subtype,
  description,
  technical_specs,
  sku,
  location_id,
  is_consumable,
  minimum_stock,
  current_stock,
  unit,
  expiration_date,
  status
)
select
  'Pienso seco 20kg',
  'pienso-seco-20kg',
  'food',
  'canino',
  'Saco de alimento para perros rescatados.',
  '{"format":"20kg","species":"dog"}'::jsonb,
  'FOOD-001',
  l.id,
  true,
  5,
  3,
  'saco',
  current_date + interval '25 days',
  'low'
from public.locations l
where l.name = 'Cocina'
on conflict (slug) do nothing;

