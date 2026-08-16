-- ESTADO: PROPUESTA. No aplicada. Para revisión de Luis.
-- ============================================================================
-- MIGRACIÓN F2c — Inmovilizado: activos y su amortización
-- Proyecto: hostelero · Fecha: 17-08-2026
--
-- ============================================================================
-- ANTES DE NADA: LO QUE HAY EN fin_plan_cuentas NO ES UN PLAN DE CUENTAS
-- ============================================================================
-- Comprobado contra la base: las 635 filas de fin_plan_cuentas son subcuentas
-- de PROVEEDOR (400000001 COCA-COLA, 400000002 CARLOS BOSCH...), todas del
-- grupo 4 y con origen 'a3'. Lo que se migró fue compras_cuenta_a3, que es el
-- fichero de cuentas de proveedor, no el plan contable.
--
-- No hay ni una cuenta del grupo 2 (inmovilizado), ni 6 (gastos), ni 7
-- (ingresos), ni 57 (tesorería). Es decir: hoy no se puede contabilizar nada.
--
-- Esta migración NO arregla eso — el plan contable de verdad está en A3 y hay
-- que exportarlo de allí, para que coincida con el que usa la asesoría. Lo que
-- sí hace es sembrar las cuentas del PGC que este módulo necesita para
-- funcionar, marcadas con origen 'pgc' para distinguirlas de las de A3.
--
-- Son las del Plan General Contable, que es norma publicada, no una elección
-- nuestra. Aun así, conviene contrastarlas con las que use la asesoría: muchas
-- empresas trabajan con más desglose del que trae el plan.
-- ============================================================================

insert into fin_plan_cuentas (cuenta_id, sociedad_id, codigo, nombre, origen)
select c.cuenta_id, c.sociedad_id, v.codigo, v.nombre, 'pgc'
from (select distinct cuenta_id, sociedad_id from fin_plan_cuentas) c
cross join (values
  -- Inmovilizado intangible y su amortización
  ('206',  'Aplicaciones informáticas'),
  ('2806', 'Amortización acumulada de aplicaciones informáticas'),
  ('680',  'Amortización del inmovilizado intangible'),
  -- Inmovilizado material
  ('210',  'Terrenos y bienes naturales'),
  ('211',  'Construcciones'),
  ('212',  'Instalaciones técnicas'),
  ('213',  'Maquinaria'),
  ('214',  'Utillaje'),
  ('215',  'Otras instalaciones'),
  ('216',  'Mobiliario'),
  ('217',  'Equipos para procesos de información'),
  ('218',  'Elementos de transporte'),
  ('219',  'Otro inmovilizado material'),
  -- Amortización acumulada del inmovilizado material
  ('2811', 'Amortización acumulada de construcciones'),
  ('2812', 'Amortización acumulada de instalaciones técnicas'),
  ('2813', 'Amortización acumulada de maquinaria'),
  ('2814', 'Amortización acumulada de utillaje'),
  ('2815', 'Amortización acumulada de otras instalaciones'),
  ('2816', 'Amortización acumulada de mobiliario'),
  ('2817', 'Amortización acumulada de equipos para procesos de información'),
  ('2818', 'Amortización acumulada de elementos de transporte'),
  ('2819', 'Amortización acumulada de otro inmovilizado material'),
  -- Dotación
  ('681',  'Amortización del inmovilizado material')
) as v(codigo, nombre)
where not exists (
  select 1 from fin_plan_cuentas p
   where p.cuenta_id = c.cuenta_id and p.codigo = v.codigo
);

-- ----------------------------------------------------------------------------
-- 1) Los activos
-- ----------------------------------------------------------------------------
-- Un activo es un bien que se compra una vez y se gasta a lo largo de varios
-- años. Lo que lo define contablemente son tres cosas: cuánto costó, en qué
-- cuenta va, y en cuántos años se reparte ese coste.
--
-- El centro es lo que permite que ese gasto aparezca en el resultado del
-- restaurante o de la bodega, y no en un saco común. Sin él, la amortización
-- ensucia la cuenta de resultados de todos por igual.

create table if not exists fin_activos (
  id                 uuid primary key default gen_random_uuid(),
  cuenta_id          uuid not null references cuentas(id),
  sociedad_id        uuid not null references sociedades(id),
  codigo             text,                       -- referencia interna, si la hay
  nombre             text not null,
  descripcion        text,
  centro_id          uuid references centros(id),

  -- Las tres cuentas del PGC que intervienen. La del activo la elige quien da
  -- de alta; las otras dos se proponen desde ella (213 → 2813 y 681) pero se
  -- pueden cambiar, porque no todas las empresas usan el mismo desglose.
  cuenta_activo_id   uuid not null references fin_plan_cuentas(id),
  cuenta_amortizacion_id uuid references fin_plan_cuentas(id),
  cuenta_dotacion_id uuid references fin_plan_cuentas(id),

  fecha_alta         date not null,              -- puesta en servicio: desde aquí se amortiza
  valor_adquisicion  numeric(14,2) not null check (valor_adquisicion >= 0),
  valor_residual     numeric(14,2) not null default 0 check (valor_residual >= 0),
  anios_vida_util    numeric(5,2) not null check (anios_vida_util > 0 and anios_vida_util <= 100),

  -- De dónde salió: la factura de compra, si se sabe. Referencia, no copia.
  compra_doc_id      uuid references compras_doc(id),
  proveedor          text,

  estado             text not null default 'alta' check (estado in ('alta','baja')),
  fecha_baja         date,
  valor_baja         numeric(14,2),
  motivo_baja        text,

  notas              text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  -- No se puede amortizar por debajo de lo que vale al final.
  constraint fin_activos_residual_coherente check (valor_residual <= valor_adquisicion),
  -- Si está de baja, la fecha es obligatoria; si está de alta, no debe haberla.
  constraint fin_activos_baja_coherente check (
    (estado = 'alta' and fecha_baja is null) or (estado = 'baja' and fecha_baja is not null)
  ),
  constraint fin_activos_baja_posterior check (fecha_baja is null or fecha_baja >= fecha_alta)
);

create trigger fin_activos_tocar before update on fin_activos
  for each row execute function fin_tocar_actualizado();

create index if not exists fin_activos_cuenta_idx on fin_activos (cuenta_id, estado);
create index if not exists fin_activos_sociedad_idx on fin_activos (sociedad_id);
create index if not exists fin_activos_centro_idx on fin_activos (centro_id);
create index if not exists fin_activos_cuenta_activo_idx on fin_activos (cuenta_activo_id);
create index if not exists fin_activos_cuenta_amort_idx on fin_activos (cuenta_amortizacion_id);
create index if not exists fin_activos_cuenta_dotacion_idx on fin_activos (cuenta_dotacion_id);
create index if not exists fin_activos_compra_idx on fin_activos (compra_doc_id);

-- ----------------------------------------------------------------------------
-- 2) El cuadro de amortización
-- ----------------------------------------------------------------------------
-- Una fila por periodo y activo. Se guarda en vez de calcularse al vuelo porque
-- una vez contabilizado un periodo, ese importe es historia: si mañana cambia
-- la vida útil, los periodos ya cerrados no se recalculan.

create table if not exists fin_amortizaciones (
  id              uuid primary key default gen_random_uuid(),
  cuenta_id       uuid not null references cuentas(id),
  activo_id       uuid not null references fin_activos(id) on delete cascade,
  ejercicio       int not null,
  periodo         int not null check (periodo between 1 and 12),
  importe         numeric(14,2) not null,
  acumulado       numeric(14,2) not null,
  contabilizado   boolean not null default false,
  asiento_id      uuid references fin_asientos(id),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  unique (activo_id, ejercicio, periodo)
);

create trigger fin_amortizaciones_tocar before update on fin_amortizaciones
  for each row execute function fin_tocar_actualizado();

create index if not exists fin_amortizaciones_activo_idx on fin_amortizaciones (activo_id);
create index if not exists fin_amortizaciones_cuenta_idx on fin_amortizaciones (cuenta_id);
create index if not exists fin_amortizaciones_periodo_idx on fin_amortizaciones (cuenta_id, ejercicio, periodo);
create index if not exists fin_amortizaciones_asiento_idx on fin_amortizaciones (asiento_id);

-- Un periodo ya contabilizado no se recalcula: su importe fue a un asiento.
create or replace function fin_amortizaciones_proteger() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.contabilizado then
    -- Se permite el paso si viene del cascade de borrar el activo entero, que
    -- ya es una decisión consciente de quien lo borra.
    if tg_op = 'DELETE' and not exists (select 1 from fin_activos where id = old.activo_id) then
      return old;
    end if;
    raise exception 'El periodo %/% de ese activo ya está contabilizado: no se recalcula', old.periodo, old.ejercicio;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists fin_amortizaciones_proteger on fin_amortizaciones;
create trigger fin_amortizaciones_proteger
  before update or delete on fin_amortizaciones
  for each row execute function fin_amortizaciones_proteger();

-- ----------------------------------------------------------------------------
-- 3) RLS — patrón de la casa
-- ----------------------------------------------------------------------------

alter table fin_activos enable row level security;
alter table fin_amortizaciones enable row level security;

drop policy if exists fin_activos_acceso on fin_activos;
create policy fin_activos_acceso on fin_activos for all
  using ((cuenta_id = cuenta_actual()) or es_operador())
  with check ((cuenta_id = cuenta_actual()) or es_operador());

drop policy if exists fin_amortizaciones_acceso on fin_amortizaciones;
create policy fin_amortizaciones_acceso on fin_amortizaciones for all
  using ((cuenta_id = cuenta_actual()) or es_operador())
  with check ((cuenta_id = cuenta_actual()) or es_operador());

-- ----------------------------------------------------------------------------
-- Comprobación posterior sugerida (en una transacción con rollback):
--
--   · Que aparecen las 24 cuentas del PGC sembradas, con origen 'pgc'.
--   · Que un activo con valor residual mayor que el de adquisición se rechaza.
--   · Que un activo 'baja' sin fecha_baja se rechaza.
--   · Que un periodo contabilizado no se puede modificar ni borrar.
--   · Que borrar el activo entero sí se lleva sus periodos por delante.
-- ----------------------------------------------------------------------------
