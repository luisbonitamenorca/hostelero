-- APLICADA 18-08-2026 (registrada como 20260818071229). Corrección de la
-- anterior, en migración nueva (una aplicada no se edita). El fallo: las
-- políticas de modulos_vetados consultaban perfiles con subselects, y la RLS
-- de perfiles solo deja ver el perfil PROPIO — la comprobación de la
-- «víctima» del veto fallaba siempre para otros usuarios, y dirección ni
-- siquiera podía listar a su gente para gestionarla.
--
-- Solución de la casa: funciones SECURITY DEFINER (leen perfiles sin pasar
-- por su RLS — el mismo motivo que en los triggers de la F5a: que «no
-- existe» y «no lo veo» no se confundan) y política nueva de lectura.

create or replace function es_direccion()
returns boolean
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from perfiles
    where id = auth.uid() and cuenta_id = cuenta_actual() and rol = 'direccion'
  );
$$;

create or replace function perfil_es_de_cuenta(p_perfil uuid, p_cuenta uuid)
returns boolean
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from perfiles where id = p_perfil and cuenta_id = p_cuenta
  );
$$;

revoke all on function es_direccion() from public;
revoke all on function es_direccion() from anon;
grant execute on function es_direccion() to authenticated;
revoke all on function perfil_es_de_cuenta(uuid, uuid) from public;
revoke all on function perfil_es_de_cuenta(uuid, uuid) from anon;
grant execute on function perfil_es_de_cuenta(uuid, uuid) to authenticated;

create policy perfiles_lectura_direccion on perfiles
  for select to authenticated
  using (cuenta_id = cuenta_actual() and es_direccion());

drop policy modulos_vetados_insert on modulos_vetados;
drop policy modulos_vetados_delete on modulos_vetados;

create policy modulos_vetados_insert on modulos_vetados
  for insert to authenticated
  with check (
    (cuenta_id = cuenta_actual() and es_direccion()
      and perfil_es_de_cuenta(perfil_id, cuenta_id))
    or es_operador()
  );

create policy modulos_vetados_delete on modulos_vetados
  for delete to authenticated
  using (
    (cuenta_id = cuenta_actual() and es_direccion())
    or es_operador()
  );
