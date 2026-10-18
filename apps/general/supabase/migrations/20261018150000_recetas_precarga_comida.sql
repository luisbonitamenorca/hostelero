-- Recetas · precarga de ingredientes (18-10-2026, decisión de Luis).
--
-- Un ingrediente por cada SUBFAMILIA de la familia COMIDA de Ratios, y se vinculan a él los
-- productos de Compras que Ratios tiene clasificados en esa subfamilia (productos_dijit.familia =
-- COMIDA y subfamilia = la de la fila; id_interno = compras_producto.codigo_interno).
--
-- Matices:
--   * En Ratios las subfamilias de COMIDA son nombres de plato (SALMOREJO, ARROZ, FINGERS…): el
--     ingrediente precargado es «lo que entra en ese plato». El chef lo afinará (renombrar, partir
--     en varios, cambiar la unidad) desde la app; esto solo evita arrancar de cero.
--   * VARIOS no se precarga (es el cajón de sastre: 798 productos sin criterio) ni los productos
--     sin subfamilia (381). Quedan «sin ingrediente» en la pestaña Productos.
--   * Unidad: kg salvo las que se compran por pieza (lista de abajo). Factor 1 en todos los
--     vínculos (no hay unidad de compra en compras_producto).
--   * Principal = el producto con más líneas de albarán/factura en los últimos 12 meses; si no
--     hay líneas, el primero por nombre.
--   * Solo Bonita (082c5366-...). Idempotente: no toca ingredientes ya existentes con ese nombre
--     ni productos ya vinculados.

do $$
declare
  v_cuenta uuid := '082c5366-d9ae-49b9-a8b8-8caad73985bd';
begin
  -- 1. Ingredientes: uno por subfamilia de COMIDA (menos VARIOS)
  insert into public.rec_ingrediente (cuenta_id, familia, subfamilia, nombre, unidad, coste_modo)
  select v_cuenta, 'COMIDA', s.nombre,
         -- Nombre legible: inicial mayúscula, resto minúsculas («CROQ.LANGOSTA» → «Croq.langosta»)
         upper(left(s.nombre, 1)) || lower(substr(s.nombre, 2)),
         case when upper(s.nombre) in ('OSTRAS','CROQUETAS','CROQ.LANGOSTA','ENSAIMADA','PAN','PAN SERVICIO','BIKINI',
                                       'FRIGO','MENU','GILDA','PATATILLAS','POSTRES','FINGERS','VIEIRA','ESCUPIÑAS')
              then 'ud' else 'kg' end,
         'auto'
  from public.subfamilias s
  join public.familias f on f.id = s.familia_id
  where upper(trim(f.nombre)) = 'COMIDA'
    and upper(trim(s.nombre)) <> 'VARIOS'
    and nullif(trim(s.nombre), '') is not null
    and not exists (select 1 from public.rec_ingrediente i
                     where i.cuenta_id = v_cuenta and lower(i.nombre) = lower(upper(left(s.nombre, 1)) || lower(substr(s.nombre, 2))));

  -- 2. Vínculos: productos de Compras clasificados por Ratios en esa subfamilia de COMIDA
  with cand as (
    select i.id as ingrediente_id, c.id as producto_id, c.nombre,
           (select count(*) from public.compras_linea l
              join public.compras_doc d on d.id = l.doc_id
             where (l.producto_id = c.id or (l.producto_id is null and l.id_producto = c.codigo_interno))
               and d.fecha >= current_date - 365) as n_lineas
    from public.rec_ingrediente i
    join public.productos_dijit pd
      on upper(trim(pd.familia)) = 'COMIDA' and trim(pd.subfamilia) = i.subfamilia
    join public.compras_producto c
      on c.cuenta_id = v_cuenta and c.codigo_interno = pd.id_interno
    where i.cuenta_id = v_cuenta and i.familia = 'COMIDA'
      and not exists (select 1 from public.rec_ingrediente_producto v where v.producto_id = c.id)
  ),
  ordenado as (
    select *, row_number() over (partition by ingrediente_id order by n_lineas desc, nombre) as pos,
           -- ¿el ingrediente ya tiene principal (de una pasada anterior o a mano)?
           exists (select 1 from public.rec_ingrediente_producto v
                    where v.ingrediente_id = cand.ingrediente_id and v.principal) as ya_principal
    from cand
  )
  insert into public.rec_ingrediente_producto (cuenta_id, ingrediente_id, producto_id, factor, principal)
  select v_cuenta, ingrediente_id, producto_id, 1, (pos = 1 and not ya_principal)
  from ordenado;
end $$;

-- VERIFICACIÓN (no se ejecuta):
--   select count(*) from rec_ingrediente where familia='COMIDA';                       -- ~85 (subfamilias de COMIDA menos VARIOS)
--   select count(*), count(*) filter (where principal) from rec_ingrediente_producto;  -- ~330 vínculos, 1 principal por ingrediente con productos
--   select i.nombre, count(v.*) from rec_ingrediente i left join rec_ingrediente_producto v on v.ingrediente_id=i.id group by 1 order by 2 desc;
