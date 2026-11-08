-- Ratios · Ingresos internos de Producción y Bodega (08-11-2026)
--
-- Hasta hoy la vista `gastos` repetía en NEGATIVO, en el centro PRODUCCION, cada
-- línea de los albaranes internos de Producción (NIF B01996826-02, proveedor
-- «→ DESTINO»). Bodega (NIF B01996826-01) no tenía espejo: sus ventas internas
-- (280.000 € en 2026) solo existían como compra en los centros de destino.
--
-- Regla de Luis (08-11-2026):
--   · Compras = compra externa neta: los abonos restan directamente, en todos
--     los centros. Lo que llega de Producción o Bodega es una compra más.
--   · Ingresos internos = solo Producción y Bodega: sus albaranes internos a
--     los centros menos sus propios abonos internos.
-- La vista sigue sirviendo el espejo en negativo (mismo formato, mismo id
-- estable) para los DOS proveedores internos; ratios.html lo separa al cargar
-- (DB.ventas_internas, en positivo) y lo enseña como «Ingresos internos».
--
-- Sin cambios de columnas: gastos_cache (select * from gastos) y el trigger
-- INSTEAD OF trg_gastos_escribir se conservan. Al final se marca la caché
-- sucia para que la próxima apertura de Ratios la rehaga.

-- Centro interno a partir del NIF del proveedor (NULL si no es interno).
-- Manda el NIF de la FICHA del proveedor; el NIF suelto del documento solo cuenta
-- si el documento no tiene ficha. Motivo: dos albaranes externos (Morvedra Vell J6,
-- Cor Gelat A8/25356) llevan por error el NIF interno en el documento y entraban
-- como ventas internas de Bodega.
create or replace function public.centro_interno_nif(nif text)
returns text
language sql
immutable
as $$
  select case regexp_replace(upper(coalesce(nif, '')), '[^A-Z0-9]', '', 'g')
    when 'B0199682601' then 'BODEGA'
    when 'B0199682602' then 'PRODUCCION'
    else null end
$$;

create or replace view public.gastos as
 -- 1) Cada línea de albarán, en su centro de destino
 SELECT - abs(hashtextextended(l.id::text, 0::bigint)) AS id,
    to_char(d.fecha::timestamp with time zone, 'YYYY-MM-DD') AS fecha,
    mapa_centro(COALESCE(NULLIF(TRIM(BOTH FROM l.canal), ''), d.canal)) AS centro,
    COALESCE(d.proveedor, '—') AS proveedor,
    COALESCE(l.producto, '—') AS producto,
    COALESCE(NULLIF(upper(TRIM(BOTH FROM pd.familia)), ''), 'COMIDA') AS familia,
    COALESCE(NULLIF(TRIM(BOTH FROM pd.subfamilia), ''), 'VARIOS') AS subfamilia,
    COALESCE(l.cantidad, 0::numeric) AS cantidad,
    'UND'::text AS unidad,
    l.importe AS base,
    l.importe AS total,
    COALESCE(pd.factor, 1::numeric) AS factor,
    COALESCE(l.cantidad, 0::numeric) * COALESCE(pd.factor, 1::numeric) AS unidades,
    EXTRACT(week FROM d.fecha)::integer AS semana,
    EXTRACT(month FROM d.fecha)::integer AS mes,
    l.created_at,
    COALESCE(p.codigo_interno, '') AS id_prod,
    'COMPRAS'::text AS origen
   FROM compras_linea l
     JOIN compras_doc d ON d.id = l.doc_id
     LEFT JOIN compras_producto p ON p.id = l.producto_id
     LEFT JOIN productos_dijit pd ON pd.id_interno = p.codigo_interno
  WHERE d.tipo = 'albaran' AND d.fecha >= '2026-01-01'::date
    AND COALESCE(d.estado_detalle, '') <> 'DUPLICADO'
    AND mapa_centro(COALESCE(NULLIF(TRIM(BOTH FROM l.canal), ''), d.canal)) <> ''
UNION ALL
 -- 2) Ajuste por albarán cuando |base − Σ líneas| > 0,15 (descuentos de pie, redondeos)
 SELECT - abs(hashtextextended('adj-' || d.id::text, 0::bigint)) AS id,
    to_char(d.fecha::timestamp with time zone, 'YYYY-MM-DD') AS fecha,
    mapa_centro(COALESCE(d.canal, c.dominante)) AS centro,
    COALESCE(d.proveedor, '—') AS proveedor,
    '— Descuento / ajuste del albarán ' || COALESCE(d.num_documento, '') AS producto,
    'COMIDA'::text AS familia,
    'VARIOS'::text AS subfamilia,
    0 AS cantidad,
    'UND'::text AS unidad,
    round(d.base - s.suma, 2) AS base,
    round(d.base - s.suma, 2) AS total,
    1 AS factor,
    0 AS unidades,
    EXTRACT(week FROM d.fecha)::integer AS semana,
    EXTRACT(month FROM d.fecha)::integer AS mes,
    d.created_at,
    ''::text AS id_prod,
    'COMPRAS'::text AS origen
   FROM compras_doc d
     JOIN LATERAL (SELECT sum(l.importe) AS suma FROM compras_linea l WHERE l.doc_id = d.id) s ON true
     LEFT JOIN LATERAL (SELECT l.canal AS dominante FROM compras_linea l
                         WHERE l.doc_id = d.id AND COALESCE(TRIM(BOTH FROM l.canal), '') <> ''
                         GROUP BY l.canal ORDER BY count(*) DESC, l.canal LIMIT 1) c ON true
  WHERE d.tipo = 'albaran' AND d.fecha >= '2026-01-01'::date
    AND COALESCE(d.estado_detalle, '') <> 'DUPLICADO'
    AND d.base IS NOT NULL AND s.suma IS NOT NULL AND abs(d.base - s.suma) > 0.15
    AND mapa_centro(COALESCE(d.canal, c.dominante)) <> ''
UNION ALL
 -- 3) Espejo en negativo de los albaranes internos, en el centro que los emite
 --    (Producción o Bodega, según el NIF del proveedor). Proveedor «→ DESTINO».
 SELECT - abs(hashtextextended('sal-' || l.id::text, 0::bigint)) AS id,
    to_char(d.fecha::timestamp with time zone, 'YYYY-MM-DD') AS fecha,
    ci.centro AS centro,
    '→ ' || mapa_centro(COALESCE(NULLIF(TRIM(BOTH FROM l.canal), ''), d.canal)) AS proveedor,
    COALESCE(l.producto, '—') AS producto,
    COALESCE(NULLIF(upper(TRIM(BOTH FROM pd.familia)), ''), 'COMIDA') AS familia,
    COALESCE(NULLIF(TRIM(BOTH FROM pd.subfamilia), ''), 'VARIOS') AS subfamilia,
    - COALESCE(l.cantidad, 0::numeric) AS cantidad,
    'UND'::text AS unidad,
    - l.importe AS base,
    - l.importe AS total,
    COALESCE(pd.factor, 1::numeric) AS factor,
    - (COALESCE(l.cantidad, 0::numeric) * COALESCE(pd.factor, 1::numeric)) AS unidades,
    EXTRACT(week FROM d.fecha)::integer AS semana,
    EXTRACT(month FROM d.fecha)::integer AS mes,
    l.created_at,
    COALESCE(p.codigo_interno, '') AS id_prod,
    'COMPRAS'::text AS origen
   FROM compras_linea l
     JOIN compras_doc d ON d.id = l.doc_id
     LEFT JOIN compras_proveedor pr ON pr.id = d.proveedor_id
     JOIN LATERAL (SELECT COALESCE(centro_interno_nif(pr.nif), CASE WHEN d.proveedor_id IS NULL THEN centro_interno_nif(d.proveedor_nif) END) AS centro) ci ON ci.centro IS NOT NULL
     LEFT JOIN compras_producto p ON p.id = l.producto_id
     LEFT JOIN productos_dijit pd ON pd.id_interno = p.codigo_interno
  WHERE d.tipo = 'albaran' AND d.fecha >= '2026-01-01'::date
    AND COALESCE(d.estado_detalle, '') <> 'DUPLICADO'
    AND mapa_centro(COALESCE(NULLIF(TRIM(BOTH FROM l.canal), ''), d.canal)) <> ''
UNION ALL
 -- 4) Espejo en negativo de los ajustes de esos albaranes internos
 SELECT - abs(hashtextextended('saladj-' || d.id::text, 0::bigint)) AS id,
    to_char(d.fecha::timestamp with time zone, 'YYYY-MM-DD') AS fecha,
    ci.centro AS centro,
    '→ ' || mapa_centro(COALESCE(d.canal, c.dominante)) AS proveedor,
    '— Ajuste del albarán interno ' || COALESCE(d.num_documento, '') AS producto,
    'COMIDA'::text AS familia,
    'VARIOS'::text AS subfamilia,
    0 AS cantidad,
    'UND'::text AS unidad,
    - round(d.base - s.suma, 2) AS base,
    - round(d.base - s.suma, 2) AS total,
    1 AS factor,
    0 AS unidades,
    EXTRACT(week FROM d.fecha)::integer AS semana,
    EXTRACT(month FROM d.fecha)::integer AS mes,
    d.created_at,
    ''::text AS id_prod,
    'COMPRAS'::text AS origen
   FROM compras_doc d
     LEFT JOIN compras_proveedor pr ON pr.id = d.proveedor_id
     JOIN LATERAL (SELECT COALESCE(centro_interno_nif(pr.nif), CASE WHEN d.proveedor_id IS NULL THEN centro_interno_nif(d.proveedor_nif) END) AS centro) ci ON ci.centro IS NOT NULL
     JOIN LATERAL (SELECT sum(l.importe) AS suma FROM compras_linea l WHERE l.doc_id = d.id) s ON true
     LEFT JOIN LATERAL (SELECT l.canal AS dominante FROM compras_linea l
                         WHERE l.doc_id = d.id AND COALESCE(TRIM(BOTH FROM l.canal), '') <> ''
                         GROUP BY l.canal ORDER BY count(*) DESC, l.canal LIMIT 1) c ON true
  WHERE d.tipo = 'albaran' AND d.fecha >= '2026-01-01'::date
    AND COALESCE(d.estado_detalle, '') <> 'DUPLICADO'
    AND d.base IS NOT NULL AND s.suma IS NOT NULL AND abs(d.base - s.suma) > 0.15
    AND mapa_centro(COALESCE(d.canal, c.dominante)) <> '';

-- La caché materializada se rehace en la próxima apertura de Ratios.
update public.ratios_cache_estado set sucio = true where clave = 'gastos';
