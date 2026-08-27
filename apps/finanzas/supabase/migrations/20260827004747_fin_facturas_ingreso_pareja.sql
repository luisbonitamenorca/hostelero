-- (28-08-2026) fin_facturas_ingreso versión final: estado de cobro
-- ('caja' | 'banco' | 'pendiente' | 'compensada') y columna «pareja» — para
-- una FV↔FD compensadas, el número de la factura del otro lado: la FD dice a
-- quién rectifica y la FV quién la anula. El total de las nominativas sale
-- del apunte de cliente (43x), con lo que las rectificativas lucen negativo.

drop function fin_facturas_ingreso();
create or replace function fin_facturas_ingreso()
returns table(asiento_id uuid, numero bigint, fecha date, tipo text, descripcion text, total numeric, cobro text, pareja text)
language sql stable
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
  where a.estado = 'confirmado' and a.origen_tipo = 'manual'
    and (a.descripcion like 'Fra. %' or a.descripcion like 'Ventas %')
  order by a.fecha desc, a.numero desc;
$$;
