-- Fichaje móvil propio (01-10-2026). Revisión de la app del empleado (app/empleado):
-- rrhh_fichajes solo tenía insert para gestores/encargados (rrhh_fichajes_gestion) y lectura
-- propia (rrhh_fichajes_propio). El empleado con fichaje móvil activado insertaba desde la app con
-- su sesión y chocaba con la RLS. El kiosco no lo sufre (va con service role por el handler).
--
-- Aditiva e idempotente. Misma convención que el resto: (select cuenta_actual()) / (select mi_empleado_id()).
-- El empleado solo puede insertar un fichaje suyo, de método movil_geo, sin corrección ni tablet,
-- en uno de sus centros (rrhh_mis_centros) y solo si su ficha tiene fichaje_movil y no está de baja.
-- La subconsulta sobre empleados pasa por la RLS del propio empleado (empleados_propio).

drop policy if exists rrhh_fichajes_propio_movil on public.rrhh_fichajes;
create policy rrhh_fichajes_propio_movil on public.rrhh_fichajes
  for insert to authenticated
  with check (
    cuenta_id = (select cuenta_actual())
    and empleado_id = (select mi_empleado_id())
    and metodo = 'movil_geo'
    and corrige_a is null
    and dispositivo_id is null
    and centro_id in (select rrhh_mis_centros())
    and exists (
      select 1
      from public.empleados e
      where e.id = rrhh_fichajes.empleado_id
        and e.fichaje_movil
        and (e.fecha_baja is null or e.fecha_baja > (now() at time zone 'Europe/Madrid')::date)
    )
  );

-- VERIFICACIÓN (solo lectura):
-- select policyname, cmd from pg_policies where tablename = 'rrhh_fichajes';
--   → rrhh_fichajes_gestion (ALL), rrhh_fichajes_propio (SELECT), rrhh_fichajes_propio_movil (INSERT)
