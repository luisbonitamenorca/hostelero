-- APLICADA 21-09-2026 (registrada como 20260921112427)
-- Régimen de IVA de la factura de compra: interior (CNAC), adquisición
-- intracomunitaria (CCEE) o inversión del sujeto pasivo (SUJPAS).
-- Indicaciones de Esther (Microgés) y documento de Lucía, 21-09-2026:
--  · A3: CABREGIVA = CCEE / SUJPAS y LINTIPIVA con el tipo de IVA que corresponde
--    (normalmente ORD21) aunque la factura venga sin IVA, para que A3 haga la
--    autorrepercusión sin cambiar el total.
--  · Asiento: gasto (debe) + IVA soportado autorrepercutido (debe) + IVA
--    repercutido (haber) + proveedor por el total (haber). Cuentas del plan de
--    A3: 472000800/477000800 intracomunitaria, 472000500/477000500 ISP.
-- Columnas nuevas: compras_proveedor.regimen_iva (null = automático por NIF),
-- compras_proveedor.tipo_iva_autorep (ORD21 por defecto), compras_doc.regimen_iva
-- (forzar en la factura). Funciones: compras_regimen_iva(doc), compras_pct_iva(tipo).
-- Vista compras_a3_export_preview recreada con cabregiva y los bloqueos ajustados;
-- exportar_a3_anual usa el régimen; compras_construir_asiento hace la autorrepercusión.

alter table compras_proveedor add column if not exists regimen_iva text check (regimen_iva in ('CNAC','CCEE','SUJPAS'));
alter table compras_proveedor add column if not exists tipo_iva_autorep text default 'ORD21' check (tipo_iva_autorep in ('ORD21','RED10','SRE','REGESP12'));
alter table compras_doc add column if not exists regimen_iva text check (regimen_iva in ('CNAC','CCEE','SUJPAS'));

create or replace function compras_regimen_iva(p_doc uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(d.regimen_iva, p.regimen_iva,
    case
      when regexp_replace(upper(coalesce(p.nif,'')),'[^A-Z0-9]','','g')
           ~ '^(AT|BE|BG|HR|CY|CZ|DK|EE|FI|FR|DE|EL|HU|IE|IT|LV|LT|LU|MT|NL|PL|PT|RO|SK|SI|SE|XI)[0-9A-Z]{7,}' then 'CCEE'
      when regexp_replace(upper(coalesce(p.nif,'')),'[^A-Z0-9]','','g') ~ '^[A-Z]{2}[0-9A-Z]{5,}'
           and regexp_replace(upper(coalesce(p.nif,'')),'[^A-Z0-9]','','g') !~ '^ES' then 'SUJPAS'
      when exists (select 1 from compras_doc_reparto r where r.doc_id = d.id and upper(coalesce(r.tipo_iva,'')) like 'REGESP%') then 'REGESP'
      else 'CNAC' end)
  from compras_doc d left join compras_proveedor p on p.id = d.proveedor_id where d.id = p_doc
$$;
create or replace function compras_pct_iva(p_tipo text) returns int language sql immutable as $$
  select case upper(coalesce(p_tipo,'')) when 'ORD21' then 21 when 'RED10' then 10 when 'SRE' then 4 when 'REGESP12' then 12 when 'GANPE105' then 10 else 0 end
$$;

-- compras_a3_export_preview: recreada con la columna cabregiva (compras_regimen_iva),
-- lintipiva = tipo_iva_autorep del proveedor en CCEE/SUJPAS, sin el bloqueo de
-- "tipo de IVA indeterminado" en esos regímenes y con bloqueo nuevo si la
-- factura CCEE/SUJPAS trae IVA. exportar_a3_anual: cabregiva = v.cabregiva.
-- compras_construir_asiento: en CCEE/SUJPAS, cuota = base × tipo al debe
-- (472000800 / 472000500) y al haber (477000800 / 477000500); proveedor por el
-- total; si la factura trae IVA se avisa y no se contabiliza.
-- (Cuerpos completos en la base: pg_get_viewdef / pg_get_functiondef.)
