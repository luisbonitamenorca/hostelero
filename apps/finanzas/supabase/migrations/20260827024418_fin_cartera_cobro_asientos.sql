-- (28-08-2026, nocturno) Cartera de COBROS para las facturas de ingreso:
-- las de Ágora no son fin_facturas sino asientos, así que fin_vencimientos
-- gana asiento_id — un vencimiento de cobro puede colgar de una factura
-- propia (TPV) O de un asiento de ingreso. Se rellenó para las nominativas
-- pendientes (Transferencia/Giro, vencimiento a 30 días; las rectificativas
-- negativas no generan cobro) y la conciliación lo mantiene: liquidar un
-- apunte de cliente rebaja su vencimiento; deshacer lo repone.
-- fin_conciliar_liquidando y fin_desconciliar_liquidando redefinidas con la
-- sincronía de cobros (la _liq lleva asiento_origen). Definiciones completas
-- en la base; cambios: además del update de pagos por compra_doc_id, un
-- update gemelo sobre fin_vencimientos con sentido='cobro' y
-- asiento_id = asiento del apunte liquidado.

alter table fin_vencimientos add column asiento_id uuid references fin_asientos(id) on delete cascade;
create unique index fin_vencimientos_asiento_unico on fin_vencimientos(asiento_id) where asiento_id is not null;
alter table fin_vencimientos drop constraint fin_vencimientos_origen;
alter table fin_vencimientos add constraint fin_vencimientos_origen check (
  (sentido = 'cobro' and compra_doc_id is null and (factura_id is not null or asiento_id is not null))
  or (sentido = 'pago' and compra_doc_id is not null and factura_id is null and asiento_id is null)
);

-- Relleno inicial (ejecutado sobre la cuenta real):
-- insert into fin_vencimientos (cuenta_id, sociedad_id, sentido, asiento_id, fecha_vencimiento, importe, importe_liquidado, estado)
-- select a.cuenta_id, a.sociedad_id, 'cobro', f.asiento_id, f.fecha + 30, f.total, 0, 'pendiente'
-- from fin_facturas_ingreso() f join fin_asientos a on a.id = f.asiento_id
-- where f.cobro = 'pendiente' and f.total > 0
--   and not exists (select 1 from fin_vencimientos v where v.asiento_id = f.asiento_id);
