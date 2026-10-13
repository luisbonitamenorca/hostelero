-- PROPUESTA 13-10-2026 · Las funciones de informes solo devuelven la cuenta del que consulta
--
-- Síntoma (Luis, 13-10): en PyG Pruebas los ingresos y el personal salían «el doble» que
-- en Ratios y en el PyG de A3. Causa: la RLS de la casa deja a un OPERADOR ver todas las
-- cuentas ((cuenta_id = cuenta_actual()) or es_operador()) y estas funciones agregaban
-- fin_apuntes SIN filtrar por cuenta. Luis es operador, así que el informe sumaba Bonita
-- Menorca + Bonita Sandbox (que tiene el diario de A3 completo: 7.708 asientos). Julio de
-- 2026: 1.137.887 € reales (igual que Ágora) frente a 2.275.774 € devueltos.
--
-- Afecta a todo lo que lee estas funciones: PyG Pruebas y, en Finanzas, Balance, Pérdidas y
-- ganancias, Sumas y saldos, Mayor y Facturas emitidas. Se añade el filtro por
-- cuenta_actual() a las tres. (Las pantallas que consultan tablas directamente llevan
-- ahora su .eq('cuenta_id') en el código de la app.)

create or replace function public.fin_informe_mensual(p_anio integer)
returns table(codigo text, nombre text, fecha date, centro_id uuid, debe numeric, haber numeric)
language sql
stable
set search_path to 'public', 'pg_temp'
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
  where a.cuenta_id = (select cuenta_actual())
    and a.fecha >= make_date(p_anio, 1, 1)
    and a.fecha <= make_date(p_anio, 12, 31)
  group by pc.codigo, pc.nombre, date_trunc('month', a.fecha), p.centro_id
  order by pc.codigo, 3
$$;

comment on function public.fin_informe_mensual(integer) is
  'Agregado mensual por cuenta, mes y centro de la CUENTA DEL QUE CONSULTA (cuenta_actual()); un operador no ve mezcladas las demás cuentas.';

create or replace function public.fin_mayor_saldos(p_prefijos text[])
returns table(codigo text, nombre text, debe numeric, haber numeric, saldo numeric, apuntes integer, ultima_fecha date)
language sql
stable
set search_path to 'public'
as $$
  select pc.codigo, pc.nombre,
         round(sum(ap.debe), 2), round(sum(ap.haber), 2),
         round(sum(ap.debe - ap.haber), 2),
         count(*)::int, max(a.fecha)
  from fin_plan_cuentas pc
  join fin_apuntes ap on ap.cuenta_plan_id = pc.id
  join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
  where pc.cuenta_id = (select cuenta_actual())
    and a.cuenta_id = (select cuenta_actual())
    and exists (select 1 from unnest(p_prefijos) pr where pc.codigo like pr || '%')
  group by pc.codigo, pc.nombre
  order by pc.codigo;
$$;

create or replace function public.fin_facturas_ingreso()
returns table(asiento_id uuid, numero bigint, fecha date, tipo text, descripcion text, total numeric, cobro text, pareja text)
language sql
stable
set search_path to 'public'
as $$
  select a.id, a.numero, a.fecha,
         case when a.descripcion like 'Fra. %' then 'nominativa' else 'diaria' end,
         a.descripcion,
         case when a.descripcion like 'Fra. %'
           then (select round(sum(ap.debe - ap.haber), 2) from fin_apuntes ap
                 join fin_plan_cuentas pc on pc.id = ap.cuenta_plan_id and pc.codigo like '43%'
                 where ap.asiento_id = a.id)
           else (select round(sum(ap.debe), 2) from fin_apuntes ap where ap.asiento_id = a.id)
         end,
         case
           when a.descripcion like 'Ventas %' then 'caja'
           when exists (select 1 from fin_apuntes ap where ap.asiento_id = a.id
                        and ap.id in (select fin_apuntes_compensados())) then 'compensada'
           when exists (select 1 from fin_apuntes ap join fin_banco_mov_apuntes ma on ma.apunte_id = ap.id
                        where ap.asiento_id = a.id) then 'banco'
           when exists (select 1 from fin_asientos cb where cb.origen_tipo = 'manual'
                        and cb.origen_id = a.id and cb.estado = 'confirmado') then 'caja'
           else 'pendiente'
         end,
         (select substring(pa.descripcion from '^Fra\. (\S+)')
          from fin_compensaciones fc
          join fin_apuntes apx on apx.id in (fc.apunte_debe, fc.apunte_haber) and apx.asiento_id = a.id
          join fin_apuntes apy on apy.id = case when fc.apunte_debe = apx.id then fc.apunte_haber else fc.apunte_debe end
          join fin_asientos pa on pa.id = apy.asiento_id
          limit 1)
  from fin_asientos a
  where a.cuenta_id = (select cuenta_actual())
    and a.estado = 'confirmado' and a.origen_tipo = 'manual'
    and (a.descripcion like 'Fra. %' or a.descripcion like 'Ventas %')
  order by a.fecha desc, a.numero desc;
$$;
