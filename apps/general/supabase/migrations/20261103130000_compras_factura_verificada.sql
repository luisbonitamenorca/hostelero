-- APLICADA 03-11-2026 (registrada como compras_factura_verificada) · Compras: «esta factura tiene un bloqueo pero está bien: quiero darla por buena».
--
-- Los bloqueos de A3 son de dos clases:
--   · DATOS QUE FALTAN para el fichero (código de proveedor, nº, fecha, cuenta de gasto, centro, base,
--     tipo de IVA, modelo/porcentaje de IRPF, retención parcial sin línea, reparto descuadrado). Sin ellos
--     la fila de A3 sale incompleta o errónea: NO se pueden saltar, hay que rellenar el dato.
--   · COMPROBACIONES DE COHERENCIA que una persona puede resolver mirando la factura:
--       - intracomunitaria / inversión del sujeto pasivo con IVA en el documento
--       - el desglose de IVA leído por el OCR no cuadra con la base/IVA guardados
--       - base + IVA − retención no da el total
--     Estas son las que una factura «verificada» se salta.
--
-- verificada_at/por/nota en compras_doc. Un trigger la deshace si después cambian los importes, el
-- proveedor o el régimen de IVA (lo verificado ya no es lo que hay). verificada_por se rellena con el
-- email del token si el cliente no lo manda.

alter table public.compras_doc
  add column if not exists verificada_at   timestamptz,
  add column if not exists verificada_por  text,
  add column if not exists verificada_nota text;

comment on column public.compras_doc.verificada_at is
  'Dada por buena a mano: se saltan los bloqueos de coherencia (intracom. con IVA, desglose de IVA, base+IVA−ret≠total). Se borra sola si cambian importes, proveedor o régimen.';

create or replace function public.compras_doc_verificada_trg() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    -- Si lo que se verificó cambia, la verificación cae (salvo que en este mismo update se esté verificando).
    if new.verificada_at is not null and new.verificada_at is not distinct from old.verificada_at and (
         new.base         is distinct from old.base
      or new.iva          is distinct from old.iva
      or new.retencion    is distinct from old.retencion
      or new.total        is distinct from old.total
      or new.proveedor_id is distinct from old.proveedor_id
      or new.regimen_iva  is distinct from old.regimen_iva
    ) then
      new.verificada_at := null; new.verificada_por := null; new.verificada_nota := null;
    end if;
  end if;
  if new.verificada_at is not null and new.verificada_por is null then
    new.verificada_por := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'app');
  end if;
  if new.verificada_at is null then
    new.verificada_por := null; new.verificada_nota := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_compras_doc_verificada on public.compras_doc;
create trigger trg_compras_doc_verificada
  before insert or update on public.compras_doc
  for each row execute function public.compras_doc_verificada_trg();

-- Misma vista que antes; solo cambian las tres comprobaciones de coherencia (condicionadas a NO
-- verificada) y se añade verificada_at al final. Las funciones de exportación (cardinality(bloqueos)=0)
-- no cambian: una verificada sin otros bloqueos entra en el fichero.
create or replace view public.compras_a3_export_preview as
 SELECT c.doc_id,
    l.orden,
    c.cabfecha,
    c.cabnumdoc,
    c.cabfechacontable,
    c.cabreferencia,
    c.cabcodpro,
    l.lindesclin,
    l.linprcmoneda,
        CASE
            WHEN rg.regimen = ANY (ARRAY['CCEE'::text, 'SUJPAS'::text]) THEN COALESCE(NULLIF(p.tipo_iva_autorep, ''::text), 'ORD21'::text)
            ELSE l.lintipiva
        END AS lintipiva,
    l.linctacon,
    l.lincentrocoste,
    c.proveedor_nombre,
    c.base_factura,
    c.total,
    l.reparto_explicito,
    c.a3_exportado_at,
    array_remove(ARRAY[
        CASE WHEN c.cabcodpro IS NULL THEN 'sin código proveedor A3'::text ELSE NULL::text END,
        CASE WHEN c.cabreferencia IS NULL THEN 'sin nº factura'::text ELSE NULL::text END,
        CASE WHEN c.cabfecha IS NULL THEN 'sin fecha'::text ELSE NULL::text END,
        CASE WHEN l.linctacon IS NULL THEN 'sin cuenta de gasto'::text ELSE NULL::text END,
        CASE WHEN l.lincentrocoste IS NULL THEN 'sin centro de coste'::text ELSE NULL::text END,
        CASE WHEN COALESCE(l.linprcmoneda, 0::numeric) = 0::numeric THEN 'sin base imponible'::text ELSE NULL::text END,
        CASE
            WHEN l.lintipiva IS NULL AND COALESCE(l.linprcmoneda, 0::numeric) <> 0::numeric AND (rg.regimen <> ALL (ARRAY['CCEE'::text, 'SUJPAS'::text])) THEN 'tipo de IVA indeterminado — hace falta desglose'::text
            ELSE NULL::text
        END,
        CASE
            WHEN d.verificada_at IS NULL AND (rg.regimen = ANY (ARRAY['CCEE'::text, 'SUJPAS'::text])) AND COALESCE(c.iva_factura, 0::numeric) <> 0::numeric THEN 'factura intracomunitaria / inversión del sujeto pasivo con IVA en el documento: revisar'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(c.retencion, 0::numeric) > 0::numeric AND c.captipoirpf IS NULL THEN 'tiene retención pero el proveedor no tiene modelo 111/115 definido'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(c.retencion, 0::numeric) > 0::numeric AND c.capporirpf IS NULL THEN 'tiene retención pero no hay porcentaje'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(c.retencion, 0::numeric) > 0::numeric AND c.retencion_base IS NOT NULL AND abs(c.retencion_base - COALESCE(c.base_factura, 0::numeric)) > 0.02 AND NOT (EXISTS ( SELECT 1
               FROM compras_a3_lineas l2
              WHERE l2.doc_id = c.doc_id AND abs(l2.linprcmoneda - c.retencion_base) <= 0.02)) THEN 'retención parcial: su base no coincide con ninguna línea'::text
            ELSE NULL::text
        END,
        CASE
            WHEN d.verificada_at IS NULL AND c.desglose_cuadra IS FALSE THEN 'el desglose de IVA leído no cuadra con la base/IVA guardados'::text
            ELSE NULL::text
        END,
        CASE
            WHEN d.verificada_at IS NULL AND c.importes_cuadran IS FALSE THEN 'base + IVA − retención no da el total'::text
            ELSE NULL::text
        END,
        CASE
            WHEN q.cuadra IS FALSE THEN ('reparto descuadrado en '::text || q.diferencia) || ' €'::text
            ELSE NULL::text
        END], NULL::text) AS bloqueos,
        CASE
            WHEN COALESCE(c.retencion, 0::numeric) = 0::numeric THEN NULL::text
            WHEN c.retencion_base IS NULL OR abs(c.retencion_base - COALESCE(c.base_factura, 0::numeric)) <= 0.02 THEN c.captipoirpf
            WHEN abs(l.linprcmoneda - c.retencion_base) <= 0.02 THEN c.captipoirpf
            ELSE NULL::text
        END AS captipoirpf,
        CASE
            WHEN COALESCE(c.retencion, 0::numeric) = 0::numeric THEN NULL::numeric
            WHEN c.retencion_base IS NULL OR abs(c.retencion_base - COALESCE(c.base_factura, 0::numeric)) <= 0.02 THEN c.capporirpf
            WHEN abs(l.linprcmoneda - c.retencion_base) <= 0.02 THEN c.capporirpf
            ELSE NULL::numeric
        END AS capporirpf,
    c.retencion,
    c.retencion_base,
    rg.regimen AS cabregiva,
    d.verificada_at
   FROM compras_a3_cabecera c
     JOIN compras_a3_lineas l ON l.doc_id = c.doc_id
     LEFT JOIN compras_doc d ON d.id = c.doc_id
     LEFT JOIN compras_proveedor p ON p.id = d.proveedor_id
     LEFT JOIN LATERAL ( SELECT compras_regimen_iva(c.doc_id) AS regimen) rg ON true
     LEFT JOIN compras_doc_reparto_cuadre q ON q.doc_id = c.doc_id;
