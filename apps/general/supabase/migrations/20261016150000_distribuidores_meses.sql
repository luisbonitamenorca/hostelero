-- Distribuidores (16-10-2026, tarde): presupuesto por meses. Los clientes de temporada abren,
-- por ejemplo, de abril a octubre: cada línea del presupuesto lleva sus meses activos y el
-- presupuesto sale anualizado y mensualizado por módulo.
--
-- Aditiva e idempotente. Las líneas (jsonb) ganan la clave «meses» (lista de meses 1..12 en los que
-- el módulo está enchufado); las guardadas antes de hoy, sin esa clave, se entienden a 12 meses.

alter table public.dist_presupuestos
  add column if not exists meses_apertura integer[] not null default '{1,2,3,4,5,6,7,8,9,10,11,12}',
  add column if not exists total_anual numeric not null default 0;

comment on column public.dist_presupuestos.meses_apertura is 'Meses (1..12) en que abre el cliente. Plantilla para los meses de cada línea nueva; cada línea puede desviarse.';
comment on column public.dist_presupuestos.total_anual is 'Σ precio × cantidad × nº de meses activos de cada línea, con el descuento aplicado. Lo calcula el panel.';
comment on column public.dist_presupuestos.total_mensual is 'Media mensual = total_anual / 12 (desde el 16-10-2026; antes era la cuota de un mes a 12 meses).';
comment on column public.dist_presupuestos.lineas is 'Copia de las líneas elegidas: [{precio_id, orden, modulo, plan, contenido, tipo, precio, cantidad, meses:[1..12]}]. Sin «meses» = los 12.';

-- Presupuestos anteriores a hoy: anual = mensual × 12 y la media mensual se queda igual.
update public.dist_presupuestos set total_anual = total_mensual * 12 where total_anual = 0 and total_mensual <> 0;
