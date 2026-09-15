delete from public.inventory_container_items a
using public.inventory_container_items b
where a.item_id = b.item_id
  and a.created_at < b.created_at;

create unique index if not exists inventory_container_items_one_container_per_item_idx
on public.inventory_container_items (item_id);
