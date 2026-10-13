-- APLICADA 13-10-2026 (registrada como 20261013200500) · Ficha de proveedor: forma de pago y plazo (Luis)
--
-- fin_proveedor_condiciones ya tenía dias_pago y forma_pago (texto libre). Luis
-- quiere en la ficha la FORMA (transferencia, giro, tarjeta…) y un PLAZO que no
-- siempre es «a N días»: también «el primer lunes después de 30 días» o «el día
-- 10 del mes siguiente a los 60 días». Se añade cómo se interpreta el plazo:
--
--   plazo_tipo = 'dias'       → vence a fecha factura + dias_pago
--   plazo_tipo = 'dia_semana' → fecha + dias_pago y después el primer <plazo_dia>
--                               de la semana (1 = lunes … 7 = domingo)
--   plazo_tipo = 'dia_mes'    → fecha + dias_pago y después el primer día
--                               <plazo_dia> del mes (1..31; si el mes no lo
--                               tiene, el último día del mes)
--
-- La fecha la calcula la app (lib/cartera.ts, función pura con pruebas); la
-- base solo guarda la regla. Las formas de pago se eligen de una lista cerrada
-- en la app, pero la columna sigue siendo texto para no romper lo que ya hay.

alter table public.fin_proveedor_condiciones
  add column if not exists plazo_tipo text not null default 'dias'
    check (plazo_tipo in ('dias', 'dia_semana', 'dia_mes')),
  add column if not exists plazo_dia smallint
    check (plazo_dia is null or (plazo_dia between 1 and 31));

-- Coherencia: con 'dia_semana' el día va de 1 a 7; con 'dias' no hay día.
alter table public.fin_proveedor_condiciones
  drop constraint if exists fin_proveedor_condiciones_plazo_coherente;
alter table public.fin_proveedor_condiciones
  add constraint fin_proveedor_condiciones_plazo_coherente check (
    (plazo_tipo = 'dias'       and plazo_dia is null) or
    (plazo_tipo = 'dia_semana' and plazo_dia between 1 and 7) or
    (plazo_tipo = 'dia_mes'    and plazo_dia between 1 and 31)
  );

comment on column public.fin_proveedor_condiciones.plazo_tipo is
  'Cómo se interpreta dias_pago: dias (fecha + N), dia_semana (fecha + N y después el primer día de la semana plazo_dia, 1=lunes), dia_mes (fecha + N y después el primer día plazo_dia del mes).';
comment on column public.fin_proveedor_condiciones.plazo_dia is
  'Día de la semana (1-7) o del mes (1-31) según plazo_tipo. Null con plazo_tipo = dias.';
comment on column public.fin_proveedor_condiciones.forma_pago is
  'Forma de pago habitual: transferencia, giro (recibo domiciliado), tarjeta, efectivo, confirming, pagaré, otra. Texto para tolerar lo antiguo; la app ofrece la lista.';
