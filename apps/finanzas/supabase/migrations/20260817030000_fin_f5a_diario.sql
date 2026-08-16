-- ESTADO: PROPUESTA. No aplicada. Para revisión de Luis.
-- Revisada 17-08-2026: se cierra el UPDATE directo que confirmaba sin pasar por
-- fin_confirmar_asiento(), se bloquea el padre al insertar apuntes y se valida
-- que el ejercicio sea de la sociedad del asiento.
-- ============================================================================
-- MIGRACIÓN F5a — El diario: confirmar un asiento
-- Proyecto: hostelero · Fecha: 17-08-2026
--
-- QUÉ FALTABA
-- fin_asientos y fin_apuntes existen desde la F0, pero nunca se escribió lo
-- que las gobierna. La propia F0 lo dejó anotado:
--
--   «el cuadre debe=haber por asiento lo garantiza la función de
--    contabilización (F1/F2), no un constraint diferido»
--
-- Esa función no existía. Hoy hay 0 asientos y 0 apuntes, así que no se ha
-- roto nada todavía — pero en cuanto haya una pantalla para meter asientos a
-- mano, sin esto se pueden guardar asientos descuadrados, sin numerar, en un
-- periodo ya cerrado, y editar después uno ya contabilizado. Un diario que
-- admite eso no vale para nada: los tres informes que salen de él (sumas y
-- saldos, balance y pérdidas y ganancias) dejan de cuadrar y no hay forma de
-- saber cuál de los asientos miente.
--
-- POR QUÉ EN LA BASE Y NO EN LA APP
-- Por lo mismo que la expedición de facturas. La app es un cliente más: con
-- la sesión de un usuario se puede escribir por la API de Supabase sin pasar
-- por ninguna pantalla. Si la única defensa es el formulario, no hay defensa.
--
-- QUÉ ENTRA AQUÍ
--   1. Un asiento nace SIEMPRE borrador y sin número (el mismo agujero que la
--      F2b cerró en facturas: `estado` tiene default 'confirmado', así que hoy
--      un INSERT directo nace confirmado y sin pasar por ningún control).
--   2. fin_confirmar_asiento(): comprueba, numera y confirma, en una sola
--      transacción.
--   3. Un asiento confirmado es inmutable, y sus apuntes también. Lo que está
--      mal se corrige con otro asiento, no borrando el anterior.
--
-- QUÉ NO ENTRA
--   · Nada de contabilización automática de facturas, activos o cobros. Eso es
--     la F5b y necesita antes el plan de cuentas real de A3: hoy el plan tiene
--     635 subcuentas de proveedor y solo dos cuentas de resultado (680 y 681),
--     así que no hay dónde llevar una venta ni una compra.
--   · Nada de cierre de ejercicio ni asiento de regularización (F5c).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Un asiento nace borrador y sin número
--
-- El default de la columna era 'confirmado', que para una tabla que iba a
-- llenarse desde una función de contabilización tenía sentido, y para una que
-- se llena desde un formulario es justo al revés. Se cambia ANTES de poner el
-- trigger: si no, un `insert` que simplemente no menciona `estado` heredaría
-- 'confirmado' del default y el trigger lo rechazaría, dejando la tabla
-- imposible de escribir. Salió en la prueba, no en la lectura del código.
-- ----------------------------------------------------------------------------

alter table fin_asientos alter column estado set default 'borrador';

create or replace function fin_asientos_nacer_borrador() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Confirmar es SIEMPRE un UPDATE, y solo lo hace fin_confirmar_asiento().
  if new.estado <> 'borrador' then
    raise exception 'Un asiento solo puede nacer en borrador. Para confirmarlo, fin_confirmar_asiento()';
  end if;
  if new.numero is not null then
    raise exception 'El número de asiento lo asigna la confirmación, no quien inserta';
  end if;
  return new;
end $$;

create trigger fin_asientos_nacer_borrador_ins before insert on fin_asientos
  for each row execute function fin_asientos_nacer_borrador();

-- ----------------------------------------------------------------------------
-- 2) Inmutabilidad del asiento confirmado
-- ----------------------------------------------------------------------------

create or replace function fin_asientos_proteger() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then
      raise exception 'El asiento % está confirmado: se corrige con otro asiento, no se borra', old.numero;
    end if;
    return old;
  end if;

  -- Mientras es borrador se puede tocar todo MENOS el estado y el número, que
  -- son competencia exclusiva de fin_confirmar_asiento().
  --
  -- Esta guarda no es adorno. La RLS da UPDATE completo sobre la tabla a
  -- cualquier usuario de la cuenta, así que sin ella basta un
  --   update fin_asientos set estado = 'confirmado', numero = 1 where id = …
  -- para saltarse el cuadre de partida doble, el ejercicio abierto, la fecha,
  -- el mes bloqueado, la validación de cuentas y el lock de numeración. Es el
  -- mismo error que la F2b tuvo que corregir en facturas: cerrar el INSERT y
  -- dejar abierta la ventana de al lado.
  if old.estado = 'borrador' then
    if new.estado is distinct from old.estado
       or new.numero is distinct from old.numero then
      -- La marca la pone fin_confirmar_asiento() justo antes de su update, y es
      -- local a la transacción. Se compara contra el id para que la marca de un
      -- asiento no sirva para colar otro en la misma transacción.
      if coalesce(current_setting('fin.confirmando', true), '') <> old.id::text then
        raise exception 'El estado y el número los asigna fin_confirmar_asiento()';
      end if;
    end if;
    return new;
  end if;

  raise exception 'El asiento % está confirmado y no se modifica', old.numero;
end $$;

create trigger fin_asientos_proteger_upd before update on fin_asientos
  for each row execute function fin_asientos_proteger();
create trigger fin_asientos_proteger_del before delete on fin_asientos
  for each row execute function fin_asientos_proteger();

-- ----------------------------------------------------------------------------
-- 3) Los apuntes solo se tocan mientras el asiento es borrador
--
-- OJO con el borrado en cascada, que es la trampa que ya mordió en las líneas
-- de factura (fallo de la F0, arreglado en la F0b): al borrar el asiento, el
-- cascade dispara este trigger cuando el padre YA NO existe, el select no
-- encuentra fila y un `is distinct from 'borrador'` daría cierto sobre NULL.
-- Por eso se distingue explícitamente «no hay padre» de «el padre no es
-- borrador»: sin padre, se deja pasar.
-- ----------------------------------------------------------------------------

create or replace function fin_apuntes_proteger() returns trigger
language plpgsql set search_path = public as $$
declare
  v_estado text;
  v_existe boolean;
begin
  if tg_op in ('UPDATE','DELETE') then
    select true, estado into v_existe, v_estado from fin_asientos where id = old.asiento_id;
    if v_existe and v_estado <> 'borrador' then
      raise exception 'Los apuntes de un asiento confirmado son inmutables';
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    -- `for share` serializa contra el `for update` de fin_confirmar_asiento().
    -- Sin él, el `for update` bloquea la CABECERA pero no impide que otra
    -- transacción meta un apunte DESPUÉS de que se hayan sumado el debe y el
    -- haber: quedaría un asiento confirmado, inmutable y descuadrado, que es
    -- justo el estado que esta migración existe para hacer imposible.
    -- Con el bloqueo, ese insert espera y, cuando entra, ya ve 'confirmado'.
    select true, estado into v_existe, v_estado
      from fin_asientos where id = new.asiento_id for share;
    if not v_existe then
      raise exception 'El apunte apunta a un asiento que no existe';
    end if;
    if v_estado <> 'borrador' then
      raise exception 'No se añaden apuntes a un asiento confirmado';
    end if;
    return new;
  end if;

  return old;
end $$;

create trigger fin_apuntes_proteger_ins before insert on fin_apuntes
  for each row execute function fin_apuntes_proteger();
create trigger fin_apuntes_proteger_upd before update on fin_apuntes
  for each row execute function fin_apuntes_proteger();
create trigger fin_apuntes_proteger_del before delete on fin_apuntes
  for each row execute function fin_apuntes_proteger();

-- ----------------------------------------------------------------------------
-- 4) Confirmar: comprobar, numerar y cerrar
-- ----------------------------------------------------------------------------

create or replace function fin_confirmar_asiento(p_asiento_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_a        fin_asientos%rowtype;
  v_ej       fin_ejercicios%rowtype;
  v_apuntes  int;
  v_debe     numeric(14,2);
  v_haber    numeric(14,2);
  v_ajenas   int;
  v_bloq     boolean;
  v_numero   bigint;
begin
  select * into v_a from fin_asientos where id = p_asiento_id for update;
  if not found then
    raise exception 'El asiento no existe';
  end if;

  -- SECURITY DEFINER se salta la RLS: el permiso se comprueba aquí a mano.
  if v_a.cuenta_id is distinct from cuenta_actual() and not es_operador() then
    raise exception 'Sin permiso sobre este asiento';
  end if;

  if v_a.estado <> 'borrador' then
    raise exception 'El asiento ya está confirmado';
  end if;

  -- El ejercicio tiene que estar abierto y la fecha caer dentro.
  select * into v_ej from fin_ejercicios where id = v_a.ejercicio_id;
  if not found then
    raise exception 'El ejercicio del asiento no existe';
  end if;
  -- No hay FK compuesta que ate sociedad_id del asiento con la del ejercicio, y
  -- la numeración va por ejercicio: un asiento de la sociedad A colgado del
  -- ejercicio de la sociedad B entraría en la serie de B. Ya se comprueba lo
  -- mismo para las cuentas del plan más abajo; faltaba aquí.
  if v_ej.sociedad_id <> v_a.sociedad_id then
    raise exception 'El ejercicio % no pertenece a la sociedad del asiento', v_ej.anio;
  end if;
  if v_ej.estado <> 'abierto' then
    raise exception 'El ejercicio % está cerrado', v_ej.anio;
  end if;
  if v_a.fecha < v_ej.fecha_inicio or v_a.fecha > v_ej.fecha_fin then
    raise exception 'La fecha % queda fuera del ejercicio % (% a %)',
      to_char(v_a.fecha, 'DD-MM-YYYY'), v_ej.anio,
      to_char(v_ej.fecha_inicio, 'DD-MM-YYYY'), to_char(v_ej.fecha_fin, 'DD-MM-YYYY');
  end if;

  -- Y el mes no puede estar bloqueado. Para eso existe fin_periodos.bloqueado,
  -- que hasta hoy no lo miraba nadie.
  select bloqueado into v_bloq
    from fin_periodos
   where ejercicio_id = v_a.ejercicio_id
     and mes = extract(month from v_a.fecha)::int;
  --
  -- DECISIÓN PENDIENTE DE LUIS: el coalesce trata «no hay fila de periodo» como
  -- «mes abierto». Si un ejercicio se creara sin sembrar sus doce periodos, el
  -- bloqueo mensual no protegería nada, y en silencio. Hoy no muerde (el único
  -- ejercicio tiene sus 12, y fin_periodos es unique por (ejercicio_id, mes)).
  -- Las dos salidas: (a) que el alta de ejercicio siembre los doce periodos —
  -- preferible, el fallo se ve donde nace — o (b) que la ausencia sea excepción
  -- aquí, más defensivo pero convierte un dato de configuración que falta en un
  -- error a pie de asiento. Se deja como está hasta que Luis elija.
  if coalesce(v_bloq, false) then
    raise exception 'El mes % de % está bloqueado: no admite asientos nuevos',
      extract(month from v_a.fecha)::int, v_ej.anio;
  end if;

  -- Partida doble: al menos dos apuntes y las dos columnas iguales.
  select count(*), coalesce(sum(debe), 0), coalesce(sum(haber), 0)
    into v_apuntes, v_debe, v_haber
    from fin_apuntes where asiento_id = v_a.id;

  if v_apuntes < 2 then
    raise exception 'Un asiento necesita al menos dos apuntes (tiene %)', v_apuntes;
  end if;
  if v_debe <> v_haber then
    raise exception 'El asiento no cuadra: debe % y haber % (diferencia %)',
      v_debe, v_haber, v_debe - v_haber;
  end if;
  if v_debe = 0 then
    raise exception 'Un asiento con todo a cero no se confirma';
  end if;

  -- Todas las cuentas usadas tienen que ser del plan de ESTA sociedad y estar
  -- activas. Una cuenta de otra sociedad en el diario descuadraría su balance.
  select count(*) into v_ajenas
    from fin_apuntes ap
    join fin_plan_cuentas pc on pc.id = ap.cuenta_plan_id
   where ap.asiento_id = v_a.id
     and (pc.sociedad_id is distinct from v_a.sociedad_id or not pc.activo);
  if v_ajenas > 0 then
    raise exception 'Hay % apunte(s) con cuenta de otra sociedad o desactivada', v_ajenas;
  end if;

  -- Numeración correlativa por ejercicio. El lock serializa dos confirmaciones
  -- simultáneas: sin él, ambas leerían el mismo max() y chocarían contra el
  -- índice único fin_asientos_numero_unico.
  perform pg_advisory_xact_lock(hashtext('fin_asiento_' || v_a.ejercicio_id::text));

  select coalesce(max(numero), 0) + 1 into v_numero
    from fin_asientos where ejercicio_id = v_a.ejercicio_id;

  -- Marca local a la transacción: es lo que autoriza al trigger a dejar pasar el
  -- cambio de estado y número. Sin ella, un update a mano no confirma.
  perform set_config('fin.confirmando', v_a.id::text, true);

  update fin_asientos
     set numero = v_numero,
         estado = 'confirmado'
   where id = v_a.id;

  return jsonb_build_object(
    'numero', v_numero,
    'fecha',  to_char(v_a.fecha, 'DD-MM-YYYY'),
    'debe',   v_debe,
    'haber',  v_haber
  );
end $$;

-- El mismo cinturón que la F1b puso a expedir y anular: que anon no pueda ni
-- llamarla. Supabase concede EXECUTE a anon por defecto en cada función nueva
-- del esquema public, y esa concesión es explícita: revocar de PUBLIC no la
-- quita. (Por dentro ya se comprueba cuenta_actual(), que para un anónimo es
-- nulo; esto es la segunda capa.)
revoke execute on function fin_confirmar_asiento(uuid) from anon;

-- ============================================================================
-- COMPROBACIONES SUGERIDAS DESPUÉS DE APLICAR
--
-- Todas dentro de `begin; ... rollback;` para no dejar rastro.
--
--   · Insertar un asiento con estado 'confirmado' ............. debe FALLAR
--   · Insertar un asiento con numero = 1 ...................... debe FALLAR
--   · Insertar un asiento normal (borrador, sin número) ....... debe PASAR
--   · CONFIRMARLO A MANO con un update de estado y número ..... debe FALLAR
--     (la revisión del 17-08: era el agujero gordo)
--   · Ponerle número a mano dejándolo en borrador ............. debe FALLAR
--   · Cambiarle la descripción estando en borrador ............ debe PASAR
--     (la guarda no puede estorbar a lo que sí se puede editar)
--   · Confirmar con un ejercicio de OTRA sociedad ............. debe FALLAR
--   · Confirmarlo con un solo apunte .......................... debe FALLAR
--   · Confirmarlo con debe 100 y haber 90 ..................... debe FALLAR
--   · Confirmarlo con debe 100 y haber 100 .................... debe PASAR y
--     devolver numero = 1
--   · Volver a confirmarlo .................................... debe FALLAR
--   · Cambiarle la descripción una vez confirmado ............. debe FALLAR
--   · Añadirle un apunte una vez confirmado ................... debe FALLAR
--   · Borrar el asiento confirmado ............................ debe FALLAR
--   · Borrar un asiento EN BORRADOR que tiene apuntes ......... debe PASAR
--     (este es el caso que falló en facturas y motivó la F0b; aquí el trigger
--      de apuntes distingue «sin padre» de «padre no borrador»)
-- ============================================================================
