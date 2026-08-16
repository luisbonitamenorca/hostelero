-- ESTADO: PROPUESTA. No aplicada. Para revisión de Luis.
-- ============================================================================
-- MIGRACIÓN F1c — Rectificativas: falta decir de qué forma se rectifica
-- Proyecto: hostelero · Fecha: 16-08-2026
--
-- QUÉ FALTA HOY
-- fin_facturas ya admite los tipos R1–R5 y ya guarda a qué factura rectifican
-- (factura_rectificada_id) y por qué (motivo_rectificacion). Pero le falta un
-- dato que la AEAT exige y que no se puede deducir de los otros: si la
-- rectificación es POR SUSTITUCIÓN o POR DIFERENCIAS.
--
--   S — por sustitución: la rectificativa contiene la factura correcta entera,
--       y sustituye a la original.
--   I — por diferencias: la rectificativa contiene solo la diferencia respecto
--       a la original, normalmente en negativo.
--
-- Las dos son válidas y la elección es del que factura, no del programa. Sin
-- este campo, quien reciba la factura no sabe si el importe es el total
-- corregido o el ajuste, y a la hora de remitir a la AEAT el registro quedaría
-- incompleto.
--
-- POR QUÉ AHORA Y NO DESPUÉS
-- Porque una factura expedida es inmutable. Si se emiten rectificativas antes
-- de tener la columna, esas filas se quedan sin el dato PARA SIEMPRE: no se
-- pueden rellenar luego. Es de las pocas cosas que de verdad no admiten
-- "ya lo añadiremos".
--
-- Referencias: códigos R1–R5 y S/I de las listas del diseño de registro de la
-- AEAT (mismos que en el SII). La forma de proceder ante errores está en el
-- apartado 17 de "Aclaraciones a dudas de los desarrolladores" (04-12-2025):
-- un error sobre una operación real se corrige SIEMPRE con rectificativa, y su
-- registro es un registro de alta normal — no hay tipo especial, así que
-- fin_expedir_factura sirve tal cual.
-- ============================================================================

alter table fin_facturas
  add column if not exists tipo_rectificativa text
  check (tipo_rectificativa in ('S', 'I'));

comment on column fin_facturas.tipo_rectificativa is
  'S = por sustitución (contiene la factura correcta entera), I = por diferencias (contiene solo el ajuste). Obligatorio en tipos R1–R5.';

-- Una rectificativa sin decir a quién rectifica y de qué forma no es una
-- rectificativa. Se exige en la tabla, no solo en la app: la app se puede
-- saltar, la restricción no.
alter table fin_facturas
  drop constraint if exists fin_facturas_rectificativa_completa;

alter table fin_facturas
  add constraint fin_facturas_rectificativa_completa
  check (
    tipo not in ('R1','R2','R3','R4','R5')
    or (factura_rectificada_id is not null and tipo_rectificativa is not null)
  );

-- Para poder responder rápido a "¿esta factura tiene rectificativas?", que es
-- lo que se pregunta al abrir el detalle de una factura expedida.
create index if not exists fin_facturas_rectifica_idx
  on fin_facturas (factura_rectificada_id)
  where factura_rectificada_id is not null;

-- ----------------------------------------------------------------------------
-- Comprobación posterior sugerida (en una transacción con rollback):
--
--   begin;
--   -- Debe FALLAR: rectificativa sin decir a quién rectifica ni de qué forma.
--   insert into fin_facturas (cuenta_id, sociedad_id, serie_id, ejercicio, tipo, estado)
--   values ('<cuenta>', '<sociedad>', '<serie>', 2026, 'R1', 'borrador');
--   rollback;
--
--   -- Y debe FUNCIONAR con los dos datos puestos.
-- ----------------------------------------------------------------------------
