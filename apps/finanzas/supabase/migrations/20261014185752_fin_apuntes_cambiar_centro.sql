-- PROPUESTA (sin aplicar) — 15-09-2026
-- Cambio de centro analítico en apuntes de asientos CONFIRMADOS.
--
-- Por qué: Lucía corrige centros de coste en A3 después de que la factura ya
-- tiene asiento aquí, y el asiento confirmado es inmutable (F5a). El centro es
-- analítica, no toca debe/haber ni cuentas ni fecha: no es una corrección
-- contable y no tiene sentido anular y rehacer 38 asientos por ello.
--
-- Cómo: una función SECURITY DEFINER que solo puede cambiar centro_id, deja
-- rastro en fin_apuntes_centro_log y pone una marca local a la transacción
-- (misma técnica que fin.confirmando). El disparador fin_apuntes_proteger deja
-- pasar el UPDATE solo si (a) la marca coincide con el asiento y (b) lo único
-- que cambia es centro_id. Cualquier otro cambio sigue bloqueado.

create table if not exists fin_apuntes_centro_log (
  id            bigserial primary key,
  apunte_id     uuid not null references fin_apuntes(id) on delete cascade,
  asiento_id    uuid not null,
  centro_antes  uuid,
  centro_despues uuid,
  motivo        text,
  cambiado_por  uuid default auth.uid(),
  cambiado_en   timestamptz not null default now()
);
alter table fin_apuntes_centro_log enable row level security;
create policy "auth lectura" on fin_apuntes_centro_log for select to authenticated using (true);

create or replace function fin_apuntes_proteger() returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_viejo uuid := case when tg_op in ('UPDATE','DELETE') then old.asiento_id end;
  v_nuevo uuid := case when tg_op in ('INSERT','UPDATE') then new.asiento_id end;
  v_estado text;
  v_cuenta uuid;
begin
  -- Excepción controlada: solo cambia centro_id, con la marca de fin_apuntes_cambiar_centro()
  if tg_op = 'UPDATE'
     and coalesce(current_setting('fin.recentrando', true), '') = old.asiento_id::text
     and new.asiento_id = old.asiento_id and new.cuenta_id = old.cuenta_id
     and new.cuenta_plan_id = old.cuenta_plan_id and new.orden = old.orden
     and new.debe = old.debe and new.haber = old.haber
     and new.centro_id is distinct from old.centro_id then
    return new;
  end if;

  if v_viejo is not null and v_nuevo is not null and v_viejo <> v_nuevo then
    perform 1 from fin_asientos where id = least(v_viejo, v_nuevo) for share;
    perform 1 from fin_asientos where id = greatest(v_viejo, v_nuevo) for share;
  end if;
  if v_viejo is not null then
    select estado into v_estado from fin_asientos where id = v_viejo for share;
    if found and v_estado <> 'borrador' then
      raise exception 'Los apuntes de un asiento confirmado son inmutables';
    end if;
  end if;
  if v_nuevo is not null then
    select estado, cuenta_id into v_estado, v_cuenta from fin_asientos where id = v_nuevo for share;
    if not found then raise exception 'El apunte apunta a un asiento que no existe'; end if;
    if v_estado <> 'borrador' then raise exception 'No se añaden apuntes a un asiento confirmado'; end if;
    if new.cuenta_id is distinct from v_cuenta then
      raise exception 'El apunte pertenece a una cuenta distinta de la del asiento';
    end if;
    return new;
  end if;
  return old;
end $$;

-- Cambia el centro de los apuntes de gasto (los que tienen centro) de un asiento.
-- Solo dirección o el servicio. Devuelve cuántos apuntes cambió.
create or replace function fin_apuntes_cambiar_centro(p_asiento uuid, p_centro uuid, p_motivo text default null)
returns int
language plpgsql security definer
set search_path = public as $$
declare v_n int := 0; r record;
begin
  if not exists (select 1 from fin_asientos where id = p_asiento) then
    raise exception 'El asiento no existe';
  end if;
  if p_centro is not null and not exists (select 1 from centros where id = p_centro) then
    raise exception 'El centro no existe';
  end if;
  perform set_config('fin.recentrando', p_asiento::text, true);
  for r in select id, centro_id from fin_apuntes where asiento_id = p_asiento and centro_id is not null and centro_id is distinct from p_centro
  loop
    insert into fin_apuntes_centro_log (apunte_id, asiento_id, centro_antes, centro_despues, motivo)
    values (r.id, p_asiento, r.centro_id, p_centro, p_motivo);
    update fin_apuntes set centro_id = p_centro where id = r.id;
    v_n := v_n + 1;
  end loop;
  perform set_config('fin.recentrando', '', true);
  return v_n;
end $$;
revoke all on function fin_apuntes_cambiar_centro(uuid, uuid, text) from public, anon;
grant execute on function fin_apuntes_cambiar_centro(uuid, uuid, text) to authenticated, service_role;
