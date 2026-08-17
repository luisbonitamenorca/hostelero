-- F5c · Agregado mensual para los informes.
--
-- POR QUÉ: con el diario real (≈7.000 asientos, 21.000 apuntes) los informes
-- se traían todos los apuntes al servidor de la app en 14 consultas y el
-- cálculo iba justo de tiempo. Balance, PyG y sumas y saldos solo necesitan
-- sumas por (cuenta, mes, centro): eso son ~3.000 filas que la base agrega en
-- milisegundos. La app pide esta función cuando el periodo cae en meses
-- enteros (todos los casos salvo «entre dos fechas», que sigue el camino
-- lento con el detalle).
--
-- SEGURIDAD: security INVOKER a propósito — la función ve exactamente lo que
-- ve quien la llama, con su RLS (cuenta_actual() o es_operador()). No hay
-- definer porque no hace falta saltarse nada: solo agrupa.

create or replace function fin_informe_mensual(p_anio int)
returns table (
  codigo text,
  nombre text,
  fecha date,          -- primer día del mes del agregado
  centro_id uuid,      -- null = apuntes sin centro
  debe numeric,
  haber numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    pc.codigo,
    pc.nombre,
    date_trunc('month', a.fecha)::date,
    p.centro_id,
    sum(p.debe),
    sum(p.haber)
  from fin_apuntes p
  join fin_asientos a on a.id = p.asiento_id and a.estado = 'confirmado'
  join fin_plan_cuentas pc on pc.id = p.cuenta_plan_id
  where a.fecha >= make_date(p_anio, 1, 1)
    and a.fecha <= make_date(p_anio, 12, 31)
  group by pc.codigo, pc.nombre, date_trunc('month', a.fecha), p.centro_id
  order by pc.codigo, 3
$$;

-- La casa revoca EXECUTE por defecto (default privileges de la higiene);
-- se concede solo a quien lo usa. El doble revoke es a propósito: PUBLIC y
-- anon son concesiones separadas.
revoke all on function fin_informe_mensual(int) from public;
revoke all on function fin_informe_mensual(int) from anon;
grant execute on function fin_informe_mensual(int) to authenticated;
