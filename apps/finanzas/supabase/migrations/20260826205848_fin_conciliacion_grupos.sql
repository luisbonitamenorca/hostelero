-- Conciliación por GRUPOS (idea de Luis en guardia de vendimia, 26-08-2026):
-- un pago del banco puede ser la SUMA de varias facturas del mismo proveedor
-- (5 de 100 -> cobro de 500). Piezas:
--  · fin_banco_mov_apuntes: enlaces N apuntes <-> 1 movimiento (el 1:1 sigue
--    en fin_banco_movimientos.apunte_id). UNIQUE(apunte_id): un apunte solo
--    se concilia una vez, sea en solitario o en grupo.
--  · fin_apuntes_conciliados(): la lista única de apuntes ya usados por
--    cualquiera de las dos vías, usada por el cruce auto y las sugerencias.
--  · fin_conciliacion_grupos: propone PAREJAS de apuntes libres (±15 días,
--    suma exacta, máx. 2 propuestas por movimiento) — 27 pendientes se
--    resuelven así hoy.
--  · fin_conciliacion_candidatos: los apuntes libres cercanos (±60d, importe
--    <= movimiento) para el selector manual de tickar-hasta-cuadrar.
--  · conciliado_via admite 'grupo'.

create table fin_banco_mov_apuntes (
  movimiento_id uuid not null references fin_banco_movimientos(id) on delete cascade,
  apunte_id uuid not null references fin_apuntes(id) on delete cascade,
  cuenta_id uuid not null references cuentas(id),
  creado_en timestamptz not null default now(),
  primary key (movimiento_id, apunte_id),
  unique (apunte_id)
);

alter table fin_banco_mov_apuntes enable row level security;

create policy fin_banco_mov_apuntes_acceso on fin_banco_mov_apuntes
  for all to authenticated
  using (cuenta_id = cuenta_actual() or es_operador())
  with check (cuenta_id = cuenta_actual() or es_operador());

alter table fin_banco_movimientos drop constraint fin_banco_movimientos_conciliado_via_check;
alter table fin_banco_movimientos add constraint fin_banco_movimientos_conciliado_via_check
  check (conciliado_via in ('auto','manual','grupo'));

create or replace function fin_apuntes_conciliados()
returns setof uuid
language sql stable
set search_path to 'public'
as $$
  select apunte_id from fin_banco_movimientos where apunte_id is not null
  union
  select apunte_id from fin_banco_mov_apuntes;
$$;

-- fin_conciliar_auto y fin_conciliacion_sugerencias: mismas de antes con la
-- exclusión vía fin_apuntes_conciliados() (ver definición completa en la base;
-- el único cambio es la subconsulta de apuntes usados).

create or replace function fin_conciliacion_grupos(p_banco uuid)
returns table(mov_id uuid, ap_ids uuid[], etiqueta text)
language sql stable
set search_path to 'public'
as $$
  with libres as (
    select ap.id, a.numero, a.fecha, a.descripcion,
           case when ap.debe > 0 then ap.debe else -ap.haber end as importe,
           ap.debe, ap.haber
    from fin_apuntes ap
    join fin_bancos_cuentas bc on bc.cuenta_plan_id = ap.cuenta_plan_id and bc.id = p_banco
    join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
    where ap.id not in (select fin_apuntes_conciliados())
  ),
  pares as (
    select m.id as mov_id,
           array[x.id, y.id] as ap_ids,
           x.importe::text || ' + ' || y.importe::text
             || ' (asientos ' || x.numero || ' + ' || y.numero || ')' as etiqueta,
           row_number() over (partition by m.id
             order by abs(x.fecha - m.fecha) + abs(y.fecha - m.fecha)) as pos
    from fin_banco_movimientos m
    join libres x on abs(x.fecha - m.fecha) <= 15
    join libres y on y.id > x.id and abs(y.fecha - m.fecha) <= 15
    where m.banco_cuenta_id = p_banco and m.estado = 'pendiente'
      and ((m.importe < 0 and x.haber > 0 and y.haber > 0 and round(x.haber + y.haber, 2) = -m.importe)
        or (m.importe > 0 and x.debe > 0 and y.debe > 0 and round(x.debe + y.debe, 2) = m.importe))
  )
  select p.mov_id, p.ap_ids, p.etiqueta from pares p where p.pos <= 2
  order by p.mov_id, p.pos;
$$;

create or replace function fin_conciliacion_candidatos(p_banco uuid, p_mov uuid)
returns table(ap_id uuid, asiento_numero bigint, asiento_fecha date, descripcion text, importe numeric)
language sql stable
set search_path to 'public'
as $$
  select ap.id, a.numero, a.fecha, a.descripcion,
         case when ap.debe > 0 then ap.debe else -ap.haber end
  from fin_banco_movimientos m
  join fin_bancos_cuentas bc on bc.id = m.banco_cuenta_id
  join fin_apuntes ap on ap.cuenta_plan_id = bc.cuenta_plan_id
  join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
  where m.id = p_mov and m.banco_cuenta_id = p_banco
    and ap.id not in (select fin_apuntes_conciliados())
    and abs(a.fecha - m.fecha) <= 60
    and ((m.importe > 0 and ap.debe > 0 and ap.debe <= m.importe)
      or (m.importe < 0 and ap.haber > 0 and ap.haber <= -m.importe))
  order by abs(a.fecha - m.fecha), a.numero
  limit 60;
$$;
