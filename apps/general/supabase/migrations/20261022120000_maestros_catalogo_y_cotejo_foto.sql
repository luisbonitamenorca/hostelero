-- Compras (22-10-2026): dos cosas que van juntas porque las pidió Luis en la misma conversación.
--
--  A) MAESTROS COMUNES DE PROVEEDOR Y PRODUCTO (mae_*). Un proveedor y su catálogo son los mismos para
--     cualquier restaurante que le compre: el código de artículo, la descripción, el formato (caja de
--     6 × 0,75 l) y la tarifa oficial no dependen del cliente. Hasta hoy cada cuenta de Jano se montaba
--     su `compras_producto` a golpe de OCR. Estas tablas NO llevan cuenta_id: las lee cualquier cuenta
--     y las escribe el operador (o un script con la service key). Cada cuenta sigue teniendo sus
--     `compras_proveedor` / `compras_producto` (precios que paga ella, alias del OCR, histórico), pero
--     ahora con un puntero al maestro (mae_proveedor_id / mae_producto_id). Lo que cada cuenta paga
--     sigue en compras_linea; la comparativa «¿compro mejor que la competencia?» saldrá de cruzar eso
--     con mae_precio_tarifa, más adelante.
--
--  B) COTEJO FOTO ↔ PDF DEL ALBARÁN. Los proveedores pasan a mandar el albarán por email (PDF, lectura
--     perfecta). La foto del papel sigue haciéndose, pero como PRUEBA DE ENTREGA y para detectar
--     anotaciones a mano (faltas, devoluciones) o albaranes que nunca llegaron. compras_doc guarda el
--     PDF como documento y la foto en foto_cotejo; foto_estado resume la situación.
--
-- Aditiva e idempotente. No toca datos existentes salvo la vinculación con el maestro, que es
-- reversible (poner a null los punteros).

-- ═══════════════════════════ A. MAESTROS COMUNES ═══════════════════════════

-- Referencia de artículo normalizada para casar albaranes con el catálogo: mayúsculas, sin espacios
-- ni puntos y, si es todo dígitos, sin ceros a la izquierda («045900» = «45900»).
create or replace function public.mae_ref_norm(t text) returns text
language sql immutable as $$
  select case
    when t is null then null
    when regexp_replace(upper(btrim(t)), '[^A-Z0-9]', '', 'g') = '' then null
    when regexp_replace(upper(btrim(t)), '[^A-Z0-9]', '', 'g') ~ '^[0-9]+$'
      then coalesce(nullif(ltrim(regexp_replace(upper(btrim(t)), '[^A-Z0-9]', '', 'g'), '0'), ''), '0')
    else regexp_replace(upper(btrim(t)), '[^A-Z0-9]', '', 'g')
  end
$$;

create table if not exists public.mae_carga (
  id            uuid primary key default gen_random_uuid(),
  proveedor_id  uuid null,                      -- se rellena tras crear el proveedor (FK más abajo)
  cuenta_id     uuid null references public.cuentas(id) on delete set null,  -- quién aportó el catálogo
  archivo       text null,
  fuente        text not null default 'catalogo' check (fuente in ('catalogo', 'albaran', 'manual', 'email')),
  vigente_desde date null,
  filas         integer not null default 0,
  nuevos        integer not null default 0,
  actualizados  integer not null default 0,
  sin_cambios   integer not null default 0,
  detalle       jsonb null,
  creado_en     timestamptz not null default now()
);
comment on table public.mae_carga is 'Registro de cada carga de catálogo en el maestro común (quién, qué fichero, cuántas filas).';

create table if not exists public.mae_proveedor (
  id              uuid primary key default gen_random_uuid(),
  nif             text null,
  nif_norm        text generated always as (public.norm_nif(nif)) stored,
  nombre          text not null,
  nombre_norm     text generated always as (public.norm_nom(nombre)) stored,
  nombre_comercial text null,
  pais            text not null default 'ES',
  web             text null,
  email_albaranes text null,                    -- desde dónde manda los albaranes/facturas
  codigos_son_ean boolean not null default false, -- Biona: su «código» es el EAN
  notas           text null,
  verificado      boolean not null default false, -- true = ficha revisada por el operador
  creado_por_cuenta uuid null references public.cuentas(id) on delete set null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);
comment on table public.mae_proveedor is 'Maestro COMÚN de proveedores (sin cuenta_id): una ficha por NIF, compartida por todas las cuentas de Jano.';
create unique index if not exists mae_proveedor_nif_uq on public.mae_proveedor (nif_norm) where nif_norm is not null;
create unique index if not exists mae_proveedor_nombre_uq on public.mae_proveedor (nombre_norm) where nif_norm is null;

create table if not exists public.mae_producto (
  id              uuid primary key default gen_random_uuid(),
  proveedor_id    uuid not null references public.mae_proveedor(id) on delete cascade,
  ref_proveedor   text not null,                -- código con el que el proveedor factura
  ref_norm        text generated always as (public.mae_ref_norm(ref_proveedor)) stored,
  ref_fabricante  text null,                    -- código del fabricante (tarifas de distribuidor)
  ean             text null,
  nombre          text not null,
  nombre_norm     text generated always as (public.clave_producto(nombre)) stored,
  marca           text null,                    -- fabricante / marca (Negrini, Schara…)
  categoria       text null,
  formato         text null,                    -- texto del catálogo: «6u x 0,75l · 4,5 L»
  unidad_venta    text null check (unidad_venta in ('kg', 'ud', 'l')),  -- en qué unidad va el precio
  unidades_caja   numeric null,                 -- unidades por caja / envase de venta
  contenido       numeric null,                 -- contenido de UNA unidad (0,75)
  contenido_unidad text null check (contenido_unidad in ('kg', 'l', 'ud')),
  formato_fiable  boolean not null default false, -- true = contenido/unidades revisados
  precio_tarifa   numeric null,                 -- última tarifa oficial conocida (sin IVA)
  precio_tarifa_desde date null,
  iva_pct         numeric null,
  caducidad       text null,
  activo          boolean not null default true,
  fuente          text not null default 'catalogo' check (fuente in ('catalogo', 'albaran', 'manual', 'email')),
  carga_id        uuid null references public.mae_carga(id) on delete set null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint mae_producto_ref_uq unique (proveedor_id, ref_norm)
);
comment on table public.mae_producto is 'Catálogo COMÚN de artículos por proveedor (sin cuenta_id). Códigos, descripciones, formato y tarifa oficial. Los precios que paga cada cuenta siguen en compras_linea.';
create index if not exists mae_producto_ean_idx on public.mae_producto (ean) where ean is not null;
create index if not exists mae_producto_nombre_idx on public.mae_producto (proveedor_id, nombre_norm);

create table if not exists public.mae_precio_tarifa (
  id            uuid primary key default gen_random_uuid(),
  producto_id   uuid not null references public.mae_producto(id) on delete cascade,
  precio        numeric not null,
  desde         date not null,
  carga_id      uuid null references public.mae_carga(id) on delete set null,
  creado_en     timestamptz not null default now(),
  constraint mae_precio_tarifa_uq unique (producto_id, desde)
);
comment on table public.mae_precio_tarifa is 'Histórico de tarifas oficiales del proveedor (una fila por cambio de precio).';

do $$ begin
  alter table public.mae_carga add constraint mae_carga_proveedor_fk
    foreign key (proveedor_id) references public.mae_proveedor(id) on delete set null;
exception when duplicate_object then null; end $$;

-- actualizado_en
create or replace function public.mae_tocar() returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end $$;
drop trigger if exists mae_proveedor_tocar on public.mae_proveedor;
create trigger mae_proveedor_tocar before update on public.mae_proveedor for each row execute function public.mae_tocar();
drop trigger if exists mae_producto_tocar on public.mae_producto;
create trigger mae_producto_tocar before update on public.mae_producto for each row execute function public.mae_tocar();

-- RLS: lo lee cualquier usuario autenticado de cualquier cuenta; lo escribe el operador (o la
-- service key, que salta la RLS). Nada para anon.
do $$
declare t text;
begin
  foreach t in array array['mae_carga', 'mae_proveedor', 'mae_producto', 'mae_precio_tarifa'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke truncate, references, trigger, maintain on public.%I from authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_leer', t);
    execute format('drop policy if exists %I on public.%I', t || '_escribir', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select es_operador())) with check ((select es_operador()))', t || '_escribir', t);
  end loop;
end $$;

-- Punteros desde las tablas de cada cuenta
alter table public.compras_proveedor add column if not exists mae_proveedor_id uuid null references public.mae_proveedor(id) on delete set null;
alter table public.compras_producto  add column if not exists mae_producto_id  uuid null references public.mae_producto(id)  on delete set null;
create index if not exists compras_producto_mae_idx on public.compras_producto (mae_producto_id) where mae_producto_id is not null;
comment on column public.compras_proveedor.mae_proveedor_id is 'Ficha del maestro común (mae_proveedor). Se enlaza por NIF con mae_vincular_cuenta().';
comment on column public.compras_producto.mae_producto_id is 'Artículo del maestro común (mae_producto). Se enlaza por referencia o EAN con mae_vincular_cuenta() y al crearse por albarán.';

-- Vincula una cuenta con el maestro: proveedores por NIF; productos por referencia (o EAN) dentro del
-- proveedor ya vinculado. Completa en compras_producto lo que esté vacío (formato, unidad, unidades por
-- caja, EAN, categoría y precio de catálogo, que son las columnas que usa Pedidos). Nunca pisa un dato
-- que la cuenta ya tenía. Idempotente: se puede lanzar tras cada carga de catálogo.
create or replace function public.mae_vincular_cuenta(p_cuenta uuid)
returns table (proveedores integer, productos integer, completados integer)
language plpgsql security definer set search_path = public as $$
declare n_prov integer; n_prod integer; n_comp integer;
begin
  update compras_proveedor v set mae_proveedor_id = m.id
    from mae_proveedor m
   where v.cuenta_id = p_cuenta and v.mae_proveedor_id is null
     and v.nif_norm is not null and v.nif_norm = m.nif_norm;
  get diagnostics n_prov = row_count;

  update compras_producto p set mae_producto_id = m.id
    from compras_proveedor v, mae_producto m
   where p.proveedor_id = v.id and v.cuenta_id = p_cuenta and p.mae_producto_id is null
     and v.mae_proveedor_id is not null and m.proveedor_id = v.mae_proveedor_id
     and (
       (p.ref_proveedor is not null and mae_ref_norm(p.ref_proveedor) = m.ref_norm)
       or (m.ean is not null and (p.codigo_barras = m.ean or mae_ref_norm(p.ref_proveedor) = mae_ref_norm(m.ean)))
     );
  get diagnostics n_prod = row_count;

  update compras_producto p set
      formato          = coalesce(p.formato, m.formato),
      unidad           = coalesce(p.unidad, case m.unidad_venta when 'kg' then 'kg' when 'l' then 'litro' when 'ud' then 'unidad' end),
      unidades_formato = coalesce(p.unidades_formato, m.unidades_caja),
      codigo_barras    = coalesce(p.codigo_barras, m.ean),
      categoria        = coalesce(p.categoria, m.categoria),
      precio_catalogo  = coalesce(p.precio_catalogo, m.precio_tarifa)
    from mae_producto m
   where p.mae_producto_id = m.id and p.cuenta_id = p_cuenta
     and (p.formato is null or p.unidad is null or p.unidades_formato is null or p.codigo_barras is null
          or p.categoria is null or p.precio_catalogo is null)
     and (m.formato is not null or m.unidad_venta is not null or m.unidades_caja is not null
          or m.ean is not null or m.categoria is not null or m.precio_tarifa is not null);
  get diagnostics n_comp = row_count;

  return query select n_prov, n_prod, n_comp;
end $$;
revoke all on function public.mae_vincular_cuenta(uuid) from public, anon;
grant execute on function public.mae_vincular_cuenta(uuid) to authenticated;

-- Al dar de alta un producto por albarán (enlazar_producto_linea lo crea sin más), se intenta
-- enganchar al maestro por referencia dentro del proveedor; si casa, hereda formato y EAN.
create or replace function public.compras_producto_enlazar_maestro() returns trigger
language plpgsql as $$
declare v_mae uuid; m record;
begin
  if new.mae_producto_id is not null then return new; end if;
  select v.mae_proveedor_id into v_mae from compras_proveedor v where v.id = new.proveedor_id;
  if v_mae is null then return new; end if;
  select * into m from mae_producto
   where proveedor_id = v_mae
     and ((new.ref_proveedor is not null and ref_norm = mae_ref_norm(new.ref_proveedor))
          or (new.codigo_barras is not null and ean = new.codigo_barras))
   limit 1;
  if m.id is null and new.nombre is not null then
    select * into m from mae_producto where proveedor_id = v_mae and nombre_norm = clave_producto(new.nombre) limit 1;
  end if;
  if m.id is not null then
    new.mae_producto_id := m.id;
    new.formato := coalesce(new.formato, m.formato);
    new.unidad := coalesce(new.unidad, case m.unidad_venta when 'kg' then 'kg' when 'l' then 'litro' when 'ud' then 'unidad' end);
    new.unidades_formato := coalesce(new.unidades_formato, m.unidades_caja);
    new.codigo_barras := coalesce(new.codigo_barras, m.ean);
    new.categoria := coalesce(new.categoria, m.categoria);
    new.precio_catalogo := coalesce(new.precio_catalogo, m.precio_tarifa);
  end if;
  return new;
end $$;
drop trigger if exists trg_producto_enlaza_maestro on public.compras_producto;
create trigger trg_producto_enlaza_maestro before insert on public.compras_producto
  for each row execute function public.compras_producto_enlazar_maestro();

-- Vista cómoda: catálogo del maestro con el proveedor
create or replace view public.mae_catalogo as
  select p.id, v.id as proveedor_id, v.nombre as proveedor, v.nif, p.ref_proveedor, p.ref_fabricante, p.ean,
         p.nombre, p.marca, p.categoria, p.formato, p.unidad_venta, p.unidades_caja, p.contenido, p.contenido_unidad,
         p.precio_tarifa, p.precio_tarifa_desde, p.activo, p.fuente, p.actualizado_en
    from mae_producto p join mae_proveedor v on v.id = p.proveedor_id;
alter view public.mae_catalogo set (security_invoker = true);
revoke all on public.mae_catalogo from anon;
grant select on public.mae_catalogo to authenticated;

-- ═══════════════════════════ B. COTEJO FOTO ↔ PDF ═══════════════════════════

alter table public.compras_doc add column if not exists foto_cotejo jsonb null;
alter table public.compras_doc add column if not exists foto_estado text null;
alter table public.compras_doc drop constraint if exists compras_doc_foto_estado_chk;
alter table public.compras_doc add constraint compras_doc_foto_estado_chk
  check (foto_estado is null or foto_estado in ('OK', 'DIFERENCIAS', 'SIN_FOTO', 'SIN_PDF'));
create index if not exists compras_doc_foto_estado_idx on public.compras_doc (cuenta_id, foto_estado) where foto_estado is not null;
comment on column public.compras_doc.foto_cotejo is 'Albaranes: la foto del papel frente al PDF del proveedor. {fotos:[{url,pagina}], paginas_foto:[], lineas_foto:[{id_producto,producto,cantidad,precio_unit,importe,pagina}], anotaciones:[texto], diferencias:[{tipo,producto,pdf,foto}], total_foto, comparado_en, aceptado_por, aceptado_en, raw_foto}';
comment on column public.compras_doc.foto_estado is 'OK = foto y PDF coinciden (o dado por bueno) · DIFERENCIAS = hay que mirar · SIN_FOTO = llegó el PDF por email y nadie ha fotografiado el papel (¿llegó la mercancía?) · SIN_PDF = hay foto pero el proveedor no ha mandado el PDF.';
