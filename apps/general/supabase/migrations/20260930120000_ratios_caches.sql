-- RATIOS: carga rápida (30-09-2026)
--
-- Medido en el Chrome de Luis tras subir max rows a 10.000: 4,2 s hasta tener
-- los datos. Se reparten entre:
--   1) gastos: es una VISTA (albaranes de Compras con 4 UNION ALL y LATERAL)
--      y se recalcula entera en cada página pedida (~1,9 s por página de 10.000).
--   2) ingresos: ~20 MB que viajan enteros en cada apertura.
--
-- Arreglo:
--   1) gastos_cache: la vista materializada. Se refresca solo cuando algo ha
--      cambiado en Compras desde el último refresco: triggers por SENTENCIA
--      (no por fila) marcan "sucio" y Ratios llama a gastos_cache_asegurar()
--      antes de leer. La vista gastos NO se toca (la siguen usando PyG etc.).
--   2) ingresos.modificado_at: sello de cambio por fila (default now() al
--      insertar, trigger al actualizar). Ratios guarda las ventas en el
--      navegador y en cada apertura solo pide las cambiadas desde la última
--      vez; ratios_sello_ingresos() da recuento + último cambio para validar.
--
-- No cambia ningún dato ni lo que ve nadie. Ratios funciona igual si esta
-- migración no está aplicada (cae al camino actual).

-- ─── 1. gastos_cache ─────────────────────────────────────────────────────
create materialized view if not exists public.gastos_cache as
  select * from public.gastos;

create index if not exists gastos_cache_id_idx on public.gastos_cache (id);

-- Mismo acceso que la vista gastos: solo usuarios con sesión, solo lectura.
revoke all on public.gastos_cache from anon, authenticated;
grant select on public.gastos_cache to authenticated;

create table if not exists public.ratios_cache_estado (
  clave         text primary key,
  sucio         boolean not null default true,
  refrescado_at timestamptz
);
alter table public.ratios_cache_estado enable row level security;
-- Sin políticas: solo la tocan las funciones security definer de abajo.
revoke all on public.ratios_cache_estado from anon, authenticated;

insert into public.ratios_cache_estado (clave, sucio, refrescado_at)
values ('gastos', false, now())
on conflict (clave) do nothing;

-- Marca sucio. "and not sucio": si ya lo está no escribe nada (ni bloquea
-- la fila), así las ráfagas de guardados de Compras no se estorban.
create or replace function public.gastos_cache_marcar_sucio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update ratios_cache_estado set sucio = true where clave = 'gastos' and not sucio;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['compras_linea','compras_doc','compras_producto','productos_dijit','compras_proveedor'] loop
    execute format('drop trigger if exists zz_gastos_cache_sucio on public.%I', t);
    execute format(
      'create trigger zz_gastos_cache_sucio after insert or update or delete or truncate on public.%I
         for each statement execute function public.gastos_cache_marcar_sucio()', t);
  end loop;
end $$;

-- Refresca si hace falta y devuelve cuándo se refrescó. El candado evita dos
-- refrescos a la vez; poner sucio=false en la MISMA transacción del refresco
-- hace que un cambio de Compras que llegue durante el refresco vuelva a
-- marcarlo sucio al confirmarse (y el siguiente Ratios lo recoge).
create or replace function public.gastos_cache_asegurar()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare r timestamptz;
begin
  if exists (select 1 from ratios_cache_estado where clave = 'gastos' and sucio) then
    perform pg_advisory_xact_lock(hashtext('gastos_cache'));
    update ratios_cache_estado set sucio = false, refrescado_at = now()
      where clave = 'gastos' and sucio;
    if found then
      refresh materialized view public.gastos_cache;
    end if;
  end if;
  select refrescado_at into r from ratios_cache_estado where clave = 'gastos';
  return r;
end $$;

revoke all on function public.gastos_cache_asegurar() from public, anon;
grant execute on function public.gastos_cache_asegurar() to authenticated;
revoke all on function public.gastos_cache_marcar_sucio() from public, anon, authenticated;

-- ─── 2. ingresos.modificado_at ───────────────────────────────────────────
-- Las filas existentes toman su created_at (o ahora, si no lo tienen).
alter table public.ingresos add column if not exists modificado_at timestamptz;
update public.ingresos set modificado_at = coalesce(created_at, now()) where modificado_at is null;
alter table public.ingresos alter column modificado_at set default now();
alter table public.ingresos alter column modificado_at set not null;
create index if not exists ingresos_modificado_at_idx on public.ingresos (modificado_at);

create or replace function public.ingresos_tocar_modificado()
returns trigger
language plpgsql
as $$
begin
  new.modificado_at := now();
  return new;
end $$;

drop trigger if exists ingresos_modificado on public.ingresos;
create trigger ingresos_modificado before update on public.ingresos
  for each row execute function public.ingresos_tocar_modificado();

-- Sello: recuento + último cambio. Recuento para detectar borrados.
create or replace function public.ratios_sello_ingresos()
returns json
language sql
stable
as $$
  select json_build_object('n', count(*), 'max_mod', max(modificado_at)) from public.ingresos
$$;

grant execute on function public.ratios_sello_ingresos() to authenticated;
