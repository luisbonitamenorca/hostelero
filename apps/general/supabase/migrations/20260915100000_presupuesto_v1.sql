-- ============================================================================
-- MÓDULO PRESUPUESTO v1 (15-09-2026) — PROPUESTA (sin aplicar)
-- La aplica el chat con apply_migration; después renombrar el archivo a la versión registrada.
-- Drivers (entradas) + tablas materializadas (salidas) + vistas puente hacia
-- Ratios y PyG. Módulo aparte: Ratios y PyG NO leen de aquí todavía.
-- Centro = código de texto de Ratios/PyG (BINIFADET, BODEGA, TAMARINDOS BAR…).
-- ============================================================================

-- ─── Versiones (un presupuesto por ejercicio, con escenarios) ───────────────
create table if not exists pre_versiones (
  id               uuid primary key default gen_random_uuid(),
  cuenta_id        uuid not null,
  ejercicio        int  not null,
  nombre           text not null default 'Presupuesto',
  vigente          boolean not null default false,
  base_ejercicio   int,            -- año real de referencia (normalmente ejercicio-1)
  mes_cierre_base  int default 12, -- último mes cerrado del real; el resto se toma del presupuesto vigente del año base
  notas            text,
  creado_en        timestamptz not null default now(),
  unique (cuenta_id, ejercicio, nombre)
);
create unique index if not exists pre_versiones_vigente_uq on pre_versiones (cuenta_id, ejercicio) where vigente;

-- ─── Maestros ───────────────────────────────────────────────────────────────
create table if not exists pre_cuentas (            -- plan de cuentas (semilla: hoja PLAN DE CUENTAS)
  cuenta      text primary key,
  descripcion text not null,
  tipo        text not null default 'NORMAL',       -- NORMAL | MERCADO INTERNO
  grupo       text not null,
  grupo_desc  text not null,
  activa      boolean not null default true
);

create table if not exists pre_familias (           -- familia de venta → cuentas de venta / compra / compra interna
  familia          text primary key,
  cuenta_venta     text not null references pre_cuentas(cuenta),
  cuenta_compra    text references pre_cuentas(cuenta),
  cuenta_interna   text references pre_cuentas(cuenta),
  orden            int not null default 0
);

create table if not exists pre_departamentos (
  id    text primary key,
  orden int not null default 0
);

create table if not exists pre_convenio (           -- tabla salarial por vigencia (suele cambiar el 1 de abril)
  id             bigserial primary key,
  cuenta_id      uuid not null,
  vigente_desde  date not null,
  nivel          int  not null,
  categorias     text,
  bruto_mensual  numeric(10,2) not null,
  unique (cuenta_id, vigente_desde, nivel)
);

-- ─── Drivers de INGRESOS ────────────────────────────────────────────────────
create table if not exists pre_pauta (              -- días abiertos y horario por centro (base futura de Reservas)
  id             bigserial primary key,
  version_id     uuid not null references pre_versiones(id) on delete cascade,
  centro         text not null,
  fecha          date not null,
  abierto        boolean not null default true,
  hora_apertura  time,
  hora_cierre    time,
  nota           text,
  unique (version_id, centro, fecha)
);

create table if not exists pre_subida_mes (         -- % de subida sobre la base del año anterior
  version_id  uuid not null references pre_versiones(id) on delete cascade,
  centro      text not null,
  mes         int  not null check (mes between 1 and 12),
  pct         numeric(6,2) not null default 0,
  primary key (version_id, centro, mes)
);

create table if not exists pre_mix_familia (        -- % anual de reparto por familia (pct_ref = año anterior, referencia)
  version_id  uuid not null references pre_versiones(id) on delete cascade,
  centro      text not null,
  familia     text not null references pre_familias(familia),
  pct         numeric(7,4) not null default 0,
  pct_ref     numeric(7,4),
  primary key (version_id, centro, familia)
);

create table if not exists pre_ingresos_dia (       -- total diario por centro (editable; base = referencia año anterior)
  version_id   uuid not null references pre_versiones(id) on delete cascade,
  centro       text not null,
  fecha        date not null,
  importe      numeric(12,2) not null default 0,
  base_importe numeric(12,2),
  manual       boolean not null default false,
  actualizado_en timestamptz not null default now(),
  primary key (version_id, centro, fecha)
);

-- ─── Drivers de GASTOS ──────────────────────────────────────────────────────
create table if not exists pre_compras_pct (        -- % sobre ventas de la familia: externo e interno (ref = año anterior)
  version_id  uuid not null references pre_versiones(id) on delete cascade,
  centro      text not null,
  familia     text not null references pre_familias(familia),
  pct_ext     numeric(6,2) not null default 0,
  pct_int     numeric(6,2) not null default 0,
  ref_ext     numeric(6,2),
  ref_int     numeric(6,2),
  primary key (version_id, centro, familia)
);

create table if not exists pre_plantilla (          -- personal previsto
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references pre_versiones(id) on delete cascade,
  centro        text not null,
  departamento  text not null references pre_departamentos(id),
  nombre        text not null,
  nivel         int,
  bruto_manual  numeric(10,2),                      -- si se informa, manda sobre el convenio (jefes)
  pct_extra     numeric(5,2) not null default 10,   -- % horas extra presupuestadas (0 = no cobra horas)
  fecha_fin     date,                                -- fin previsto → finiquito ese mes
  empleado_id   uuid,                                -- enlace futuro con Personal (rrhh)
  orden         int not null default 0,
  notas         text
);
create index if not exists pre_plantilla_version_idx on pre_plantilla (version_id, centro);

create table if not exists pre_plantilla_horas (    -- horas/semana por semana ISO
  plantilla_id  uuid not null references pre_plantilla(id) on delete cascade,
  semana        int  not null check (semana between 1 and 53),
  horas         numeric(5,2) not null default 0,
  primary key (plantilla_id, semana)
);

create table if not exists pre_coef_cuenta (        -- coeficiente sobre el real del año anterior (resto de cuentas)
  version_id  uuid not null references pre_versiones(id) on delete cascade,
  centro      text not null,
  cuenta      text not null references pre_cuentas(cuenta),
  coef        numeric(6,3) not null default 1,
  primary key (version_id, centro, cuenta)
);

create table if not exists pre_parametros (         -- ss_pct=33, finiquito_pct=10, horas_semana=40 …
  version_id  uuid not null references pre_versiones(id) on delete cascade,
  clave       text not null,
  valor       numeric(12,4) not null,
  primary key (version_id, clave)
);

-- ─── Salidas materializadas ─────────────────────────────────────────────────
create table if not exists pre_ingresos (           -- DIARIO centro × familia (= formato tabla presupuesto de Ratios)
  version_id  uuid not null references pre_versiones(id) on delete cascade,
  centro      text not null,
  familia     text not null references pre_familias(familia),
  fecha       date not null,
  mes         int  generated always as (extract(month from fecha)::int) stored,
  importe     numeric(12,2) not null default 0,
  primary key (version_id, centro, familia, fecha)
);
create index if not exists pre_ingresos_mes_idx on pre_ingresos (version_id, centro, mes);

create table if not exists pre_gastos (             -- MENSUAL centro × cuenta (= formato hoja PRESUPUESTO del PyG)
  version_id   uuid not null references pre_versiones(id) on delete cascade,
  centro       text not null,
  cuenta       text not null references pre_cuentas(cuenta),
  mes          int  not null check (mes between 1 and 12),
  importe      numeric(12,2) not null default 0,
  base_importe numeric(12,2),
  origen       text not null default 'base',        -- base | compras | interno | personal | manual
  manual       boolean not null default false,
  nota         text,
  actualizado_en timestamptz not null default now(),
  primary key (version_id, centro, cuenta, mes)
);

create table if not exists pre_nominas (            -- coste bruto por departamento y mes (= presupuesto_nominas de Ratios)
  version_id    uuid not null references pre_versiones(id) on delete cascade,
  centro        text not null,
  departamento  text not null references pre_departamentos(id),
  mes           int  not null check (mes between 1 and 12),
  importe       numeric(12,2) not null default 0,
  primary key (version_id, centro, departamento, mes)
);

-- ─── Vistas puente (formato exacto de lo que leen hoy Ratios y PyG) ─────────
create or replace view v_pre_ingresos_dia as
  select v.ejercicio, i.fecha, i.centro, i.familia, i.importe, i.mes,
         extract(week from i.fecha)::int as semana
  from pre_ingresos i join pre_versiones v on v.id = i.version_id
  where v.vigente;

create or replace view v_pre_pyg_mensual as
  select v.ejercicio, g.centro as canal, g.cuenta, c.descripcion, g.mes, g.importe
  from pre_gastos g
  join pre_versiones v on v.id = g.version_id
  join pre_cuentas c on c.cuenta = g.cuenta
  where v.vigente
  union all
  select v.ejercicio, i.centro, f.cuenta_venta, c.descripcion, i.mes, sum(i.importe)
  from pre_ingresos i
  join pre_versiones v on v.id = i.version_id
  join pre_familias f on f.familia = i.familia
  join pre_cuentas c on c.cuenta = f.cuenta_venta
  where v.vigente
  group by 1,2,3,4,5;

create or replace view v_pre_nominas as
  select v.ejercicio, n.centro as canal, n.departamento, n.mes, n.importe
  from pre_nominas n join pre_versiones v on v.id = n.version_id
  where v.vigente;

-- Real diario de Ratios agregado (base del año anterior para ingresos)
create or replace view v_ingresos_real_dia as
  select fecha, centro, familia, round(sum(coalesce(base,0))::numeric, 2) as importe
  from ingresos
  group by fecha, centro, familia;

-- ─── RLS: como el bucket pyg, solo usuarios autenticados ────────────────────
do $$
declare t text;
begin
  foreach t in array array['pre_versiones','pre_cuentas','pre_familias','pre_departamentos','pre_convenio',
    'pre_pauta','pre_subida_mes','pre_mix_familia','pre_ingresos_dia','pre_compras_pct','pre_plantilla',
    'pre_plantilla_horas','pre_coef_cuenta','pre_parametros','pre_ingresos','pre_gastos','pre_nominas']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "auth all" on %I', t);
    execute format('create policy "auth all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ─── Módulo en el esqueleto ─────────────────────────────────────────────────
insert into modulos (id, nombre, area, madurez)
  values ('presupuesto', 'Presupuesto', 'Finanzas', 'beta')
  on conflict (id) do nothing;
insert into modulos_contratados (cuenta_id, modulo_id, activo)
  values ('082c5366-d9ae-49b9-a8b8-8caad73985bd', 'presupuesto', true)
  on conflict do nothing;

-- ─── Semillas ───────────────────────────────────────────────────────────────
insert into pre_departamentos (id, orden) values
  ('RECEPCION',1),('SALA',2),('COCINA',3),('PICA',4),('CAMPO',5),('BODEGA',6),('LOGISTICA',7),('OFICINA',8)
  on conflict do nothing;

insert into pre_cuentas (cuenta, descripcion, tipo, grupo, grupo_desc) values
('600000000','COMPRAS','NORMAL','6000','COMPRAS'),
('600000100','COMPRAS VINO','NORMAL','6000','COMPRAS'),
('600000101','COMPRAS INTERNAS VINO','MERCADO INTERNO','6001','COMPRAS INTERNAS'),
('600000200','COMPRAS COMIDA','NORMAL','6000','COMPRAS'),
('600000201','COMPRAS INTERNAS COMIDA','MERCADO INTERNO','6001','COMPRAS INTERNAS'),
('600000300','COMPRAS BEBIDAS','NORMAL','6000','COMPRAS'),
('600000400','COMPRAS ALCOHOLES','NORMAL','6000','COMPRAS'),
('600000500','COMPRAS VINO EXT','NORMAL','6000','COMPRAS'),
('600000600','COMPRAS VISITAS','NORMAL','6000','COMPRAS'),
('600000700','COMPRAS VARIOS','NORMAL','6000','COMPRAS'),
('600000999','TRANSPORTES SOBRE COMPRAS','NORMAL','6000','COMPRAS'),
('602000000','OTROS APROVISIONAMIENTOS','NORMAL','6020','OTROS APROVISIONAMIENTOS'),
('607000000','TRABAJOS OTRAS EMPRESAS','NORMAL','6070','TRABAJOS OTRAS EMPRESAS'),
('608000000','ABONO SOBRE COMPRAS','NORMAL','6000','COMPRAS'),
('609000000','RAPPELS','NORMAL','6000','COMPRAS'),
('621000000','ALQUILER','NORMAL','6210','ALQUILER'),
('621000100','RENTING','NORMAL','6211','RENTING'),
('621100000','RENTING','NORMAL','6211','RENTING'),
('622000000','REPARACIONES Y CONSERVACION','NORMAL','6220','MANTENIMIENTO'),
('622000001','MANTENIMIENTO INFORMATICO','NORMAL','6220','MANTENIMIENTO'),
('623000000','SERVICIOS DE PROFESIONALES INDEPENDIENTES','NORMAL','6230','ASESORAMIENTO TECNICO'),
('623000001','GESTORIA','NORMAL','6230','ASESORAMIENTO TECNICO'),
('623000002','SERVICIO PREVENCION','NORMAL','6230','ASESORAMIENTO TECNICO'),
('623000003','MUTUA','NORMAL','6230','ASESORAMIENTO TECNICO'),
('623000004','LABORATORIO','NORMAL','6230','ASESORAMIENTO TECNICO'),
('623000005','ASESORAMIENTO TECNICO','NORMAL','6230','ASESORAMIENTO TECNICO'),
('624000000','TRANSPORTES','NORMAL','6240','TRANSPORTES'),
('625000000','SEGUROS','NORMAL','6250','SEGUROS'),
('626000001','COMISION IGT (AGORA PAYMENTS)','NORMAL','6260','COMISIONES'),
('626000002','COMISION BANCARIA','NORMAL','6260','COMISIONES'),
('626000003','COMISION STRIPE (SHOPIFY)','NORMAL','6260','COMISIONES'),
('626000004','COMISION ISBA','NORMAL','6260','COMISIONES'),
('626000005','COMISION CODETICKETS','NORMAL','6260','COMISIONES'),
('627000000','MARKETING','NORMAL','6270','MARKETING'),
('628000001','ELECTRICIDAD','NORMAL','6280','SUMINISTROS'),
('628000002','AGUA','NORMAL','6280','SUMINISTROS'),
('628000003','GAS','NORMAL','6280','SUMINISTROS'),
('628000004','CARBON','NORMAL','6280','SUMINISTROS'),
('628000005','COMBUSTIBLE','NORMAL','6280','SUMINISTROS'),
('628000006','TELEFONO','NORMAL','6280','SUMINISTROS'),
('629000001','GASTOS VARIOS','NORMAL','6290','GASTOS VARIOS'),
('629000002','UNIFORMES','NORMAL','6290','GASTOS VARIOS'),
('629000003','LIMPIEZA','NORMAL','6290','GASTOS VARIOS'),
('629000004','SOFTWARE (AGORA, YUREST, SKELLO)','NORMAL','6290','GASTOS VARIOS'),
('629000005','SEGURIDAD (EXTINTORES Y CAMARAS)','NORMAL','6290','GASTOS VARIOS'),
('629000006','VAJILLA','NORMAL','6290','GASTOS VARIOS'),
('629000007','GASTOS DE INVERSION','NORMAL','6290','GASTOS VARIOS'),
('631000000','TRIBUTOS','NORMAL','6310','TRIBUTOS'),
('631000001','IBI','NORMAL','6310','TRIBUTOS'),
('640000000','SALARIOS','NORMAL','6400','SALARIOS'),
('640000001','FINIQUITOS','NORMAL','6400','SALARIOS'),
('642000000','SEGURIDAD SOCIAL','NORMAL','6400','SALARIOS'),
('649000001','FORMACION PROFESIONAL PARA EL EMPLEO','NORMAL','6490','FORMACION'),
('662000201','INTERESES PRESTAMOS','NORMAL','6620','INTERESES'),
('662000301','INTERESES PRESTAMOS','NORMAL','6620','INTERESES'),
('662200801','INTERESES PRESTAMO XAVIER LLANSO','NORMAL','6620','INTERESES'),
('669000000','INTERESES POLIZAS','NORMAL','6620','INTERESES'),
('678000000','GASTOS NO DEDUCIBLES','NORMAL','6780','GASTOS NO DEDUCIBLES'),
('680000000','AMORTIZACION INMATERIAL','NORMAL','6800','AMORTIZACION'),
('681000000','AMORTIZACION MATERIAL','NORMAL','6810','AMORTIZACION'),
('700000000','VENTAS','NORMAL','7000','VENTAS'),
('700000100','VENTAS VINO','NORMAL','7000','VENTAS'),
('700000101','VENTAS INTERNAS VINO','MERCADO INTERNO','7001','VENTAS INTERNAS'),
('700000200','VENTAS COMIDA','NORMAL','7000','VENTAS'),
('700000201','VENTAS INTERNAS COMIDA','MERCADO INTERNO','7001','VENTAS INTERNAS'),
('700000300','VENTAS BEBIDAS','NORMAL','7000','VENTAS'),
('700000400','VENTAS ALCOHOLES','NORMAL','7000','VENTAS'),
('700000500','VENTAS VINO EXT','NORMAL','7000','VENTAS'),
('700000600','VENTAS VISITAS','NORMAL','7000','VENTAS'),
('700000700','VENTAS VARIOS','NORMAL','7000','VENTAS'),
('708000000','DEVOLUCIONES','NORMAL','7080','OTROS INGRESOS'),
('740000000','SUBVENCIONES','NORMAL','7080','OTROS INGRESOS'),
('755000000','INGRESOS POR SERVICIOS AL PERSONAL','NORMAL','7080','OTROS INGRESOS'),
('766000000','BENEFICIOS EN VALORES','NORMAL','7080','OTROS INGRESOS'),
('778000000','INGRESOS EXTRAORDINARIOS','NORMAL','7780','INGRESOS EXTRAORDINARIOS')
  on conflict (cuenta) do nothing;

insert into pre_familias (familia, cuenta_venta, cuenta_compra, cuenta_interna, orden) values
  ('COMIDA',   '700000200','600000200','600000201',1),
  ('VINO',     '700000100','600000100','600000101',2),
  ('BEBIDAS',  '700000300','600000300',null,3),
  ('ALCOHOLES','700000400','600000400',null,4),
  ('VINO EXT', '700000500','600000500',null,5),
  ('VISITAS',  '700000600','600000600',null,6),
  ('VARIOS',   '700000700','600000700',null,7),
  ('ENVIOS',   '700000700','600000700',null,8),
  ('HELADOS',  '700000700','600000700',null,9)
  on conflict do nothing;

-- Convenio hostelería vigente (hoja NIVELES SALARIALES; ajustar cuando salga el de 2027)
insert into pre_convenio (cuenta_id, vigente_desde, nivel, categorias, bruto_mensual) values
  ('082c5366-d9ae-49b9-a8b8-8caad73985bd','2026-04-01',1,'Jefe cocina, jefe comedor',3000.00),
  ('082c5366-d9ae-49b9-a8b8-8caad73985bd','2026-04-01',2,'Jefe bar, 2º jefe comedor, 2º jefe cocina',2640.95),
  ('082c5366-d9ae-49b9-a8b8-8caad73985bd','2026-04-01',3,'Jefe sector, jefe partida, recepcionista',2456.79),
  ('082c5366-d9ae-49b9-a8b8-8caad73985bd','2026-04-01',4,'Camarero, cocinero',2283.26),
  ('082c5366-d9ae-49b9-a8b8-8caad73985bd','2026-04-01',5,'Ayudante camarero, ayudante cocina',2151.59),
  ('082c5366-d9ae-49b9-a8b8-8caad73985bd','2026-04-01',6,'Pinche, fregador, limpiador',2050.76)
  on conflict do nothing;
