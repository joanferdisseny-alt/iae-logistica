drop policy if exists "Admins and operators manage locations" on public.locations;
drop policy if exists "Admins and editors manage locations" on public.locations;
drop policy if exists "Admins manage locations" on public.locations;
create policy "Admins manage locations"
on public.locations
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

drop policy if exists "Admins and editors manage containers" on public.inventory_containers;
drop policy if exists "Admins manage containers" on public.inventory_containers;
create policy "Admins manage containers"
on public.inventory_containers
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');

drop policy if exists "Users can manage their own notification preferences" on public.notification_preferences;
drop policy if exists "Admins manage notification preferences" on public.notification_preferences;
create policy "Admins manage notification preferences"
on public.notification_preferences
for all
to authenticated
using (public.user_role() = 'admin')
with check (public.user_role() = 'admin');
