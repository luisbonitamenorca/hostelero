-- Recetas (18-10-2026): escandallos / food cost de los productos que se venden en Ágora.
--
-- Módulo nuevo del apartado Operaciones. App de un solo HTML (datos/recetas.html)
-- servida por app/recetas/route.ts con la sesión de la casa.
--
-- Cómo encaja con los demás módulos (decisión de Luis, 18-10-2026):
--   * COMPRAS: el listado de productos es compras_producto (lo que llega en albaranes y facturas).
--   * RATIOS: el mismo listado con Familia y Subfamilia encima (productos_dijit, id_interno =
--     compras_producto.codigo_interno) y los productos de venta de Ágora (productos_agora).
--   * RECETAS añade un TERCER nivel bajo Familia > Subfamilia: el INGREDIENTE («Tomate»,
--     «Aceite de oliva»…). Varios productos de Compras (de distintos proveedores o formatos)
--     cuelgan del mismo ingrediente, y un ingrediente lleva SIEMPRE una unidad de medida:
--     kg, l (litros) o ud (unidades). Las recetas se escriben con ingredientes, no con productos.
--   * Las recetas son los productos de Ágora (uno a uno, cargados aquí como semilla) y además
--     «preparaciones» (caldos, sofritos, salsas) que se pueden usar dentro de otras recetas.
--     El campo `tipo` las distingue: 'agora' | 'preparacion'.
--
-- Reglas (las mismas que Pedidos, Presupuesto y Distribuidores):
--   * SOLO ADITIVA e idempotente.
--   * RLS por cuenta: cuenta_id = (select cuenta_actual()) or (select es_operador()). Nada para anon.
--   * Se revocan truncate/references/trigger/maintain de authenticated.
--   * Seeds con cuenta_id explícito de Bonita (082c5366-d9ae-49b9-a8b8-8caad73985bd).
--   * NO se toca nada de compras_*, productos_agora, productos_dijit, familias ni subfamilias.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. INGREDIENTES  (Familia > Subfamilia > Ingrediente, con unidad de medida)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.rec_ingrediente (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id) on delete cascade,
  familia        text not null default '',          -- nombre tal cual en Ratios (familias.nombre)
  subfamilia     text not null default '',          -- nombre tal cual en Ratios (subfamilias.nombre)
  nombre         text not null,
  unidad         text not null default 'kg'
    constraint rec_ingrediente_unidad_chk check (unidad in ('kg', 'l', 'ud')),
  -- Coste por unidad: 'auto' = sale del producto principal vinculado (ultimo_precio / factor);
  -- 'manual' = el que se teclea en coste_manual (para lo que no pasa por Compras o se quiere fijar).
  coste_modo     text not null default 'auto'
    constraint rec_ingrediente_coste_modo_chk check (coste_modo in ('auto', 'manual')),
  coste_manual   numeric null,
  notas          text null,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint rec_ingrediente_nombre_ux unique (cuenta_id, nombre)
);
comment on table public.rec_ingrediente is 'Ingredientes de Recetas: tercer nivel bajo Familia > Subfamilia de Ratios. Siempre con unidad (kg, l, ud). Agrupa productos de Compras equivalentes.';

create index if not exists idx_rec_ingrediente_cuenta on public.rec_ingrediente (cuenta_id, familia, subfamilia, nombre);

alter table public.rec_ingrediente enable row level security;
revoke all on public.rec_ingrediente from anon;
grant select, insert, update, delete on public.rec_ingrediente to authenticated;
revoke truncate, references, trigger, maintain on public.rec_ingrediente from authenticated;
drop policy if exists rec_ingrediente_acceso on public.rec_ingrediente;
create policy rec_ingrediente_acceso on public.rec_ingrediente
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. VÍNCULO INGREDIENTE ↔ PRODUCTO DE COMPRAS
-- ═══════════════════════════════════════════════════════════════════════════
-- Un producto de Compras pertenece como mucho a UN ingrediente (unique producto_id).
-- factor = cuántas unidades del ingrediente trae UNA unidad de compra del producto
-- (p. ej. «PATATA BOLSA 5 KG» con precio por bolsa → factor 5; si el precio ya es por kg → 1).
-- principal = de qué producto se toma el coste 'auto' del ingrediente (si ninguno, el más barato).
create table if not exists public.rec_ingrediente_producto (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id) on delete cascade,
  ingrediente_id uuid not null references public.rec_ingrediente(id) on delete cascade,
  producto_id    uuid not null references public.compras_producto(id) on delete cascade,
  factor         numeric not null default 1
    constraint rec_ingrediente_producto_factor_chk check (factor > 0),
  principal      boolean not null default false,
  creado_en      timestamptz not null default now(),
  constraint rec_ingrediente_producto_ux unique (producto_id)
);
comment on table public.rec_ingrediente_producto is 'Qué productos de Compras forman cada ingrediente de Recetas. factor = unidades de ingrediente por unidad de compra; principal = el que marca el coste.';

create index if not exists idx_rec_ingrediente_producto_ing on public.rec_ingrediente_producto (ingrediente_id);
create index if not exists idx_rec_ingrediente_producto_cuenta on public.rec_ingrediente_producto (cuenta_id);

alter table public.rec_ingrediente_producto enable row level security;
revoke all on public.rec_ingrediente_producto from anon;
grant select, insert, update, delete on public.rec_ingrediente_producto to authenticated;
revoke truncate, references, trigger, maintain on public.rec_ingrediente_producto from authenticated;
drop policy if exists rec_ingrediente_producto_acceso on public.rec_ingrediente_producto;
create policy rec_ingrediente_producto_acceso on public.rec_ingrediente_producto
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RECETAS  (productos de Ágora + preparaciones)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.rec_receta (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id) on delete cascade,
  tipo           text not null default 'agora'
    constraint rec_receta_tipo_chk check (tipo in ('agora', 'preparacion')),
  agora_id       text null,                          -- productos_agora.id_prod cuando tipo = 'agora'
  nombre         text not null,
  familia        text not null default '',           -- copia de Ágora/Ratios (agora) o libre (preparacion)
  subfamilia     text not null default '',
  -- 'agora': la receta rinde `rendimiento` raciones (normalmente 1; «Arroz (2 pax)» → 2).
  -- 'preparacion': rinde `rendimiento` unidades de `unidad` (p. ej. 5 l de caldo), que es lo que
  -- se consume cuando se usa dentro de otra receta.
  rendimiento    numeric not null default 1
    constraint rec_receta_rendimiento_chk check (rendimiento > 0),
  unidad         text not null default 'ud'
    constraint rec_receta_unidad_chk check (unidad in ('kg', 'l', 'ud')),
  pvp_manual     numeric null,                       -- precio de venta sin IVA si se quiere fijar a mano
  elaboracion    text null,                          -- pasos / notas de cocina
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint rec_receta_agora_chk check (tipo <> 'agora' or agora_id is not null)
);
comment on table public.rec_receta is 'Recetas (escandallos). tipo agora = un producto de venta de Ágora (agora_id); tipo preparacion = elaboración intermedia (caldo, sofrito, salsa) reutilizable en otras recetas.';

create unique index if not exists rec_receta_agora_ux on public.rec_receta (cuenta_id, agora_id) where agora_id is not null;
create unique index if not exists rec_receta_prep_nombre_ux on public.rec_receta (cuenta_id, lower(nombre)) where tipo = 'preparacion';
create index if not exists idx_rec_receta_cuenta on public.rec_receta (cuenta_id, tipo, familia, subfamilia);

alter table public.rec_receta enable row level security;
revoke all on public.rec_receta from anon;
grant select, insert, update, delete on public.rec_receta to authenticated;
revoke truncate, references, trigger, maintain on public.rec_receta from authenticated;
drop policy if exists rec_receta_acceso on public.rec_receta;
create policy rec_receta_acceso on public.rec_receta
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LÍNEAS DE RECETA  (un ingrediente O una preparación, con cantidad)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.rec_receta_linea (
  id              uuid primary key default gen_random_uuid(),
  cuenta_id       uuid not null default cuenta_actual() references public.cuentas(id) on delete cascade,
  receta_id       uuid not null references public.rec_receta(id) on delete cascade,
  orden           integer not null default 0,
  ingrediente_id  uuid null references public.rec_ingrediente(id) on delete restrict,
  preparacion_id  uuid null references public.rec_receta(id) on delete restrict,
  cantidad        numeric not null default 0
    constraint rec_receta_linea_cantidad_chk check (cantidad >= 0),
  merma_pct       numeric not null default 0
    constraint rec_receta_linea_merma_chk check (merma_pct >= 0 and merma_pct < 100),
  notas           text null,
  creado_en       timestamptz not null default now(),
  constraint rec_receta_linea_uno_chk check ((ingrediente_id is null) <> (preparacion_id is null)),
  constraint rec_receta_linea_no_recursiva_chk check (preparacion_id is distinct from receta_id)
);
comment on table public.rec_receta_linea is 'Líneas de una receta: cantidad de un ingrediente (en su unidad) o de una preparación (en la unidad de su rendimiento). merma_pct encarece la línea.';

create index if not exists idx_rec_receta_linea_receta on public.rec_receta_linea (receta_id, orden);
create index if not exists idx_rec_receta_linea_ing on public.rec_receta_linea (ingrediente_id);
create index if not exists idx_rec_receta_linea_prep on public.rec_receta_linea (preparacion_id);
create index if not exists idx_rec_receta_linea_cuenta on public.rec_receta_linea (cuenta_id);

alter table public.rec_receta_linea enable row level security;
revoke all on public.rec_receta_linea from anon;
grant select, insert, update, delete on public.rec_receta_linea to authenticated;
revoke truncate, references, trigger, maintain on public.rec_receta_linea from authenticated;
drop policy if exists rec_receta_linea_acceso on public.rec_receta_linea;
create policy rec_receta_linea_acceso on public.rec_receta_linea
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. actualizado_en
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rec_tocar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;
revoke all on function public.rec_tocar() from public, anon, authenticated;

drop trigger if exists rec_ingrediente_tocar on public.rec_ingrediente;
create trigger rec_ingrediente_tocar before update on public.rec_ingrediente
  for each row execute function public.rec_tocar();
drop trigger if exists rec_receta_tocar on public.rec_receta;
create trigger rec_receta_tocar before update on public.rec_receta
  for each row execute function public.rec_tocar();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. PVP DE ÁGORA  (vista sobre ingresos de Ratios: últimos 12 meses)
-- ═══════════════════════════════════════════════════════════════════════════
-- Precio medio de venta SIN IVA por ración (base / cantidad) y raciones vendidas en el último año.
-- `ingresos` es de Ratios (sin cuenta_id, política de sesión); la vista hereda esa lectura.
create or replace view public.rec_agora_pvp
with (security_invoker = true) as
select
  articulo                                        as agora_id,
  sum(cantidad)                                   as raciones_12m,
  sum(base)                                       as base_12m,
  round(sum(base) / nullif(sum(cantidad), 0), 2)  as pvp_medio,
  max(fecha)                                      as ultima_venta
from public.ingresos
where fecha >= to_char(current_date - 365, 'YYYY-MM-DD')
group by articulo;
comment on view public.rec_agora_pvp is 'Recetas: precio medio de venta sin IVA por ración (base/cantidad) y raciones de los últimos 12 meses, por producto de Ágora.';
revoke all on public.rec_agora_pvp from anon;
grant select on public.rec_agora_pvp to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. SEEDS
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.modulos (id, nombre, area, madurez)
  values ('recetas', 'Recetas', 'Operaciones', 'beta')
  on conflict (id) do nothing;
insert into public.modulos_contratados (cuenta_id, modulo_id, activo)
  values ('082c5366-d9ae-49b9-a8b8-8caad73985bd', 'recetas', true)
  on conflict do nothing;

-- Todos los productos de Ágora como recetas (tipo agora), una vez. Los que aparezcan después
-- los trae el botón «Sincronizar con Ágora» de la app (misma lógica: los que falten).
insert into public.rec_receta (cuenta_id, tipo, agora_id, nombre, familia, subfamilia, rendimiento, unidad)
select '082c5366-d9ae-49b9-a8b8-8caad73985bd', 'agora', p.id_prod, coalesce(nullif(trim(p.producto), ''), 'Producto ' || p.id_prod),
       upper(coalesce(trim(p.familia), '')), coalesce(trim(p.subfamilia), ''), 1, 'ud'
from public.productos_agora p
where p.id_prod is not null
  and not exists (select 1 from public.rec_receta r
                   where r.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd' and r.agora_id = p.id_prod);

-- VERIFICACIÓN (no se ejecuta):
--   select * from modulos where id = 'recetas';                              -- Recetas / Operaciones / beta
--   select tipo, count(*) from rec_receta group by 1;                        -- agora 887
--   select count(*) from rec_agora_pvp;                                      -- productos con ventas en 12 meses
