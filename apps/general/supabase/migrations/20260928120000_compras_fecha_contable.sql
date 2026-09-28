-- FECHA CONTABLE en facturas de Compras (28-09-2026, petición de Luis/Lucía).
-- Tres fechas por factura:
--   fecha           = FECHA FACTURA: la que pone el documento del proveedor.
--   fecha_contable  = la de nuestra contabilidad: decide mes y trimestre del gasto.
--   created_at      = FECHA REGISTRO: el día que entró en el sistema (informativa).
-- Por defecto fecha_contable = fecha factura, salvo que la factura se registre
-- con su trimestre ya cerrado: entonces va a la fecha de registro. El trimestre
-- se cierra con el plazo del modelo 303: 20 de abril, 20 de julio, 20 de octubre
-- y 30 de enero (4T).
-- Lucía o Dakota pueden cambiar las dos desde el listado. El asiento y el
-- fichero de A3 (CABFECHACONTABLE) usan fecha_contable; la cartera sigue
-- venciendo desde la fecha factura.

alter table compras_doc add column if not exists fecha_contable date;

create or replace function compras_fecha_contable_defecto(p_fecha date, p_registro date)
returns date language sql immutable as $$
  select case
    when p_fecha is null then p_registro
    when p_registro is null then p_fecha
    when p_registro > ((date_trunc('quarter', p_fecha) + interval '3 months')::date - 1)
                      + case when extract(quarter from p_fecha) = 4 then 30 else 20 end
      then p_registro
    else p_fecha
  end
$$;

-- Al dar de alta la factura se calcula; si luego se corrige la fecha factura y la
-- contable seguía siendo la de por defecto, se recalcula. Una fecha contable
-- puesta a mano no se toca.
create or replace function compras_doc_fecha_contable_tg()
returns trigger language plpgsql as $$
begin
  if new.tipo <> 'factura' then return new; end if;
  if tg_op = 'INSERT' then
    if new.fecha_contable is null then
      new.fecha_contable := compras_fecha_contable_defecto(new.fecha, coalesce(new.created_at, now())::date);
    end if;
  elsif new.fecha is distinct from old.fecha
        and new.fecha_contable is not distinct from old.fecha_contable
        and (old.fecha_contable is null
             or old.fecha_contable = compras_fecha_contable_defecto(old.fecha, old.created_at::date)) then
    new.fecha_contable := compras_fecha_contable_defecto(new.fecha, old.created_at::date);
  elsif new.fecha_contable is null then
    new.fecha_contable := compras_fecha_contable_defecto(new.fecha, coalesce(old.created_at, now())::date);
  end if;
  return new;
end $$;

drop trigger if exists compras_doc_0_fecha_contable on compras_doc;
create trigger compras_doc_0_fecha_contable
  before insert or update of fecha, fecha_contable, tipo on compras_doc
  for each row execute function compras_doc_fecha_contable_tg();

-- Facturas ya cargadas: fecha contable = fecha factura, que es la que han usado
-- hasta hoy sus asientos (no se aplica la regla con la fecha de registro: el
-- histórico se recargó entero en agosto y todo caería en agosto).
update compras_doc set fecha_contable = fecha where tipo = 'factura' and fecha_contable is null;

-- Fichero de A3: CABFECHACONTABLE sale de la fecha contable.
create or replace view compras_a3_cabecera as
 SELECT d.id AS doc_id,
    d.fecha AS cabfecha,
    d.a3_numdoc AS cabnumdoc,
    COALESCE(d.fecha_contable, d.fecha) AS cabfechacontable,
    d.num_documento AS cabreferencia,
    COALESCE(p.codigo_a3, a.codigo) AS cabcodpro,
    d.base AS base_factura,
    d.iva AS iva_factura,
    d.total,
    d.estado,
    d.a3_exportado_at,
    p.nombre AS proveedor_nombre,
    p.cuenta_proveedor,
    p.cuenta_contable AS cuenta_gasto_defecto,
    COALESCE(d.canal, p.departamento) AS canal_efectivo,
    cc.codigo AS centro_coste_defecto,
        CASE
            WHEN COALESCE(d.retencion, 0::numeric) > 0::numeric THEN p.retencion_modelo
            ELSE NULL::text
        END AS captipoirpf,
        CASE
            WHEN COALESCE(d.retencion, 0::numeric) > 0::numeric THEN COALESCE(d.retencion_pct, p.retencion_pct)
            ELSE NULL::numeric
        END AS capporirpf,
    d.retencion,
    d.retencion_base,
        CASE
            WHEN d.raw ? 'desglose_iva'::text AND jsonb_array_length(COALESCE(d.raw -> 'desglose_iva'::text, '[]'::jsonb)) > 0 THEN abs(COALESCE(( SELECT sum((v.value ->> 'base'::text)::numeric) AS sum
               FROM jsonb_array_elements(d.raw -> 'desglose_iva'::text) v(value)), 0::numeric) - COALESCE(d.base, 0::numeric)) <= 0.02 AND abs(COALESCE(( SELECT sum((v.value ->> 'cuota'::text)::numeric) AS sum
               FROM jsonb_array_elements(d.raw -> 'desglose_iva'::text) v(value)), 0::numeric) - COALESCE(d.iva, 0::numeric)) <= 0.02
            ELSE NULL::boolean
        END AS desglose_cuadra,
    abs(COALESCE(d.base, 0::numeric) + COALESCE(d.iva, 0::numeric) - COALESCE(d.retencion, 0::numeric) - COALESCE(d.total, 0::numeric)) <= 0.02 AS importes_cuadran
   FROM compras_doc d
     LEFT JOIN compras_proveedor p ON p.id = d.proveedor_id
     LEFT JOIN compras_cuenta_a3 a ON a.cuenta = p.cuenta_proveedor
     LEFT JOIN compras_centro_coste cc ON cc.canal = COALESCE(d.canal, p.departamento)
  WHERE d.tipo = 'factura'::text;

-- Asiento: fecha y ejercicio desde la fecha contable (se parchea la función de
-- 20260920163855 en sus tres usos de v_doc.fecha).
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('compras_construir_asiento(uuid,text,text)'::regprocedure);
  if position('coalesce(v_doc.fecha_contable, v_doc.fecha)' in v_def) = 0 then
    v_def := replace(v_def, 'v_doc.fecha', 'coalesce(v_doc.fecha_contable, v_doc.fecha)');
    execute v_def;
  end if;
end $$;
