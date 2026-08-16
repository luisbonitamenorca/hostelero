-- ESTADO: PROPUESTA. No aplicada. Para revisión de Luis.
-- Revisada 17-08-2026: se cierra el UPDATE directo que confirmaba sin pasar por
-- fin_confirmar_asiento(), se bloquea el padre al insertar apuntes y se valida
-- que el ejercicio sea de la sociedad del asiento.
-- Revisada 17-08-2026 (2): se bloquea también el borrado de apuntes (la misma
-- carrera que el insert, por el otro lado), se cambia v_existe por found, y la
-- ausencia de fila de periodo pasa a ser excepción en vez de mes abierto.
-- Revisada 17-08-2026 (3): el disparador de apuntes pasa a SECURITY DEFINER
-- (sin eso `not found` significaba «no lo veo», no «no existe») y comprueba que
-- el apunte sea de la misma cuenta que su asiento; se bloquean también el
-- ejercicio y el periodo al confirmar, que se leían sin lock.
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
--     la F5c y necesita antes el plan de cuentas real de A3: hoy el plan tiene
--     635 subcuentas de proveedor y solo dos cuentas de resultado (680 y 681),
--     así que no hay dónde llevar una venta ni una compra.
--   · Nada de cierre de ejercicio ni asiento de regularización (F5d).
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
  -- `is distinct from` y no `<>`: con `<>`, un `estado = null` explícito da NULL,
  -- que no es cierto, y la fila se colaría por aquí. Hoy la pararía el NOT NULL
  -- de la columna, pero con el error de la restricción en vez de este mensaje.
  if new.estado is distinct from 'borrador' then
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
      --
      -- Y conviene no prometer de más: la marca es un GUARDARRAÍL, no una
      -- barrera. set_config() lo puede llamar cualquiera, así que quien tenga
      -- UPDATE por RLS y acceso SQL directo podría ponérsela él y hacer el
      -- update a mano. Por PostgREST no es alcanzable — set_config vive en
      -- pg_catalog y no se expone como RPC —, y eso es lo que hoy la sostiene.
      -- Deuda consciente: la barrera de verdad son privilegios de columna,
      --   revoke update on fin_asientos from authenticated;
      --   grant  update (<columnas editables>) on fin_asientos to authenticated;
      -- que a cambio obliga a mantener esa lista cada vez que se añada una
      -- columna. Decisión de Luis; no se implementa aquí.
      if coalesce(current_setting('fin.confirmando', true), '') <> old.id::text then
        raise exception 'El estado y el número los asigna fin_confirmar_asiento()';
      end if;
    end if;
    return new;
  end if;

  -- Se nombra el estado en vez de darlo por hecho: hoy solo existen 'borrador' y
  -- 'confirmado', pero si mañana aparece un 'anulado' este mensaje mentiría.
  raise exception 'El asiento % está en estado % y no se modifica', old.numero, old.estado;
end $$;

create trigger fin_asientos_proteger_upd before update on fin_asientos
  for each row execute function fin_asientos_proteger();
create trigger fin_asientos_proteger_del before delete on fin_asientos
  for each row execute function fin_asientos_proteger();

-- ----------------------------------------------------------------------------
-- 3) Los apuntes solo se tocan mientras el asiento es borrador
--
-- Las DOS ramas bloquean la cabecera, no solo la de insertar. La carrera es
-- simétrica y da el mismo destrozo por el otro lado: T1 está confirmando y ya
-- ha sumado dos apuntes que cuadran; T2 borra uno, lee la cabecera sin lock,
-- ve 'borrador' en su instantánea y lo borra; T1 confirma. Queda un asiento
-- confirmado, inmutable y con un solo apunte.
--
-- Se usa `found` y no una variable propia porque `select true, … into v_existe`
-- deja v_existe en NULL cuando no hay fila, no en false — y `not NULL` no es
-- cierto, así que la comprobación de «el asiento no existe» era código muerto
-- que tapaba la clave ajena.
--
-- Y va SECURITY DEFINER, que es lo que hace que `found` signifique de verdad
-- «no existe». Sin ello el disparador corre como el usuario y sus select sobre
-- fin_asientos pasan por la RLS, así que `not found` sería «no lo veo». Como la
-- política de fin_apuntes filtra por el cuenta_id DEL PROPIO APUNTE, y nada lo
-- ataba al de su asiento, un apunte de la cuenta A colgado de un asiento de la
-- cuenta B se saltaba la inmutabilidad entera: el select no encontraba al padre
-- y se dejaba pasar el borrado. Definer cierra eso, y la comprobación de
-- cuenta_id de abajo impide que esa pareja descabalada llegue a existir.
-- No abre superficie por RPC: PostgREST no expone funciones que devuelven
-- trigger.
--
-- Sobre interbloqueos: el orden cabecera-antes-que-apunte es el mismo en todos
-- los caminos. Lo que no cubría era mover un apunte de A a B mientras otra
-- transacción mueve otro de B a A — ahí se bloqueaba A→B y B→A. Por eso, cuando
-- intervienen dos asientos, se piden los dos bloqueos de golpe y ordenados por
-- id, que impone el mismo orden a las dos transacciones.
-- ----------------------------------------------------------------------------

create or replace function fin_apuntes_proteger() returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  -- El asiento del que sale el apunte y al que va. En INSERT solo hay destino;
  -- en DELETE solo origen; en UPDATE los dos, y pueden ser distintos.
  v_viejo uuid := case when tg_op in ('UPDATE','DELETE') then old.asiento_id end;
  v_nuevo uuid := case when tg_op in ('INSERT','UPDATE') then new.asiento_id end;
  v_estado text;
  v_cuenta uuid;
begin
  -- Los dos bloqueos de golpe y en orden de id: el LockRows va por encima del
  -- Sort, así que se bloquea en el orden del `order by` y dos movimientos
  -- cruzados no pueden quedarse esperándose el uno al otro.
  if v_viejo is not null and v_nuevo is not null and v_viejo <> v_nuevo then
    perform 1 from fin_asientos where id in (v_viejo, v_nuevo) order by id for share;
  end if;

  if v_viejo is not null then
    -- Si no hay fila es el cascade al borrar el asiento entero: el disparador
    -- salta con el padre ya borrado y se deja pasar. Es el mismo caso que la
    -- F0b tuvo que arreglar en las líneas de factura.
    select estado into v_estado from fin_asientos where id = v_viejo for share;
    if found and v_estado <> 'borrador' then
      raise exception 'Los apuntes de un asiento confirmado son inmutables';
    end if;
  end if;

  if v_nuevo is not null then
    select estado, cuenta_id into v_estado, v_cuenta
      from fin_asientos where id = v_nuevo for share;
    if not found then
      raise exception 'El apunte apunta a un asiento que no existe';
    end if;
    if v_estado <> 'borrador' then
      raise exception 'No se añaden apuntes a un asiento confirmado';
    end if;
    -- La RLS de fin_apuntes confía en el cuenta_id del propio apunte, que es una
    -- columna suelta. Sin esto, un apunte puede declarar una cuenta distinta de
    -- la de su asiento y quedar visible para el inquilino equivocado.
    if new.cuenta_id is distinct from v_cuenta then
      raise exception 'El apunte pertenece a una cuenta distinta de la del asiento';
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
  --
  -- `for share` porque hoy cerrar un ejercicio es un update directo bajo RLS: no
  -- hay función que lo haga. Sin el bloqueo, T1 lee 'abierto', T2 cierra y
  -- commitea, y T1 confirma igual — asiento confirmado e inmutable dentro de un
  -- ejercicio cerrado. Con él, quien cierra espera. El orden de bloqueos es
  -- siempre asiento → ejercicio → periodo, así que no hay ciclo posible.
  select * into v_ej from fin_ejercicios where id = v_a.ejercicio_id for share;
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
  -- que hasta hoy no lo miraba nadie. Con `for share` por el mismo motivo que el
  -- ejercicio: bloquear un mes también es hoy un update directo.
  select bloqueado into v_bloq
    from fin_periodos
   where ejercicio_id = v_a.ejercicio_id
     and mes = extract(month from v_a.fecha)::int
     for share;
  -- Sin fila NO se asume «mes abierto»: sería apagar el bloqueo mensual en
  -- silencio. Es un fallo de configuración del ejercicio, y el mensaje apunta
  -- ahí y no al asiento, que no tiene la culpa. La siembra de los doce periodos
  -- la garantiza el alta de ejercicio (migración F5b); esto es la segunda capa.
  if not found then
    raise exception 'El ejercicio % no tiene sembrado el periodo del mes %: revisar la configuración del ejercicio',
      v_ej.anio, extract(month from v_a.fecha)::int;
  end if;
  -- Sin coalesce: fin_periodos.bloqueado es NOT NULL con default false.
  if v_bloq then
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
  -- índice único fin_asientos_numero_unico, que va por (ejercicio_id, numero) —
  -- comprobado: el ámbito del índice y el de este lock coinciden.
  --
  -- Se usa la forma de UN argumento, aunque la de dos daría espacio de claves
  -- propio, porque es la convención que la F1a ya tiene en producción para la
  -- cadena Verifactu: hashtext('prefijo_' || uuid). Tener dos convenciones para
  -- lo mismo se paga más caro que el riesgo teórico de colisión.
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
--   · Insertar un asiento con estado = null explícito ......... debe FALLAR
--     con NUESTRO mensaje, no con el del NOT NULL de la columna
--   · Insertar un apunte con un asiento_id inventado .......... debe FALLAR
--     con NUESTRO mensaje, no con el de la clave ajena
--   · Confirmar en un mes cuya fila de fin_periodos no existe .. debe FALLAR
--     señalando la configuración del ejercicio
--   · Confirmar con el ejercicio cerrado ...................... debe FALLAR
--   · Insertar un apunte con cuenta_id distinto al del asiento . debe FALLAR
--   · Mover un apunte de un asiento a otro, los dos borradores . debe PASAR
--   · Borrar un asiento EN BORRADOR que tiene apuntes ......... debe PASAR
--     (este es el caso que falló en facturas y motivó la F0b; aquí el trigger
--      de apuntes distingue «sin padre» de «padre no borrador»)
-- ============================================================================
