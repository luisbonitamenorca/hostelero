-- ESTADO: APLICADA en producción el 17-08-2026 (registrada como 20260817112052).
-- No reaplicar. Los arreglos van en una migración nueva.
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
-- Revisada 17-08-2026 (4): privilegios de columna sobre fin_asientos, que es la
-- barrera de verdad detrás del guardarraíl de la marca. Decisión de Luis.
-- Revisada 17-08-2026 (5): el revoke necesitaba las dos concesiones (public y
-- anon, no solo anon); se añaden confirmado_por y confirmado_en, porque después
-- de confirmar ya no hay forma de escribirlos; y dos bloqueos explícitos en vez
-- de apoyarse en la forma del plan.
-- Revisada 17-08-2026 (6): el ejercicio tiene que ser de la CUENTA del asiento,
-- no solo de su sociedad; y el rastro (creado_*, confirmado_*) se escribe en el
-- disparador de nacimiento, porque después de la sección 5 no hay otro sitio.
-- Revisada 17-08-2026 (7): entran centro_id en los apuntes y el índice único de
-- origen. Las dos por decisión de Luis, y las dos ahora porque hoy son gratis y
-- dentro de unos meses no lo serían.
-- Revisada 17-08-2026 (8): el centro del apunte tiene que ser de la sociedad del
-- asiento — al añadir centro_id en la ronda 7 se añadió también la forma de
-- colarlo —, y el origen duplicado responde en castellano diciendo en qué asiento
-- está ya contabilizado.
-- Revisada 17-08-2026 (9): se revoca TRUNCATE, que se saltaba entera la
-- inmutabilidad sin pasar por disparadores ni RLS; los disparadores pasan a
-- `create or replace`; y el mensaje de origen duplicado deja de poder señalar a
-- un asiento de otro inquilino y dice de qué ejercicio habla.
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
--   · Nada de carga del diario histórico de A3. Cuando toque, la migración de
--     carga tendrá que desactivar y reactivar fin_asientos_nacer_borrador_ins
--     dentro de ella misma: el disparador impide que un asiento nazca
--     confirmado, y lo impide también para la clave de servicio. Mismo caso que
--     la F2b dejó anotado para las facturas históricas de Ágora.
--
-- QUÉ SÍ ENTRA AUNQUE TODAVÍA NO SE USE, y por qué no espera
--   · centro_id en fin_apuntes (sección 1) y el índice que impide contabilizar
--     dos veces el mismo origen (sección 6). Ninguna de las dos hace falta hoy,
--     y las dos son gratis hoy: las tablas están a cero filas. Dentro de unos
--     meses, la primera exige repartir a mano miles de apuntes cerrados e
--     inmutables, y la segunda, limpiar duplicados antes de poder crear el
--     índice. Las decidió Luis el 17-08-2026 con ese argumento.
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

-- Rastro de la confirmación. `creado_*` dice cuándo se tecleó el borrador; esto
-- dice cuándo se cerró y quién lo cerró, que es el hecho con consecuencias: fija
-- la serie y es lo que se revisa. Después de confirmar el asiento es inmutable,
-- así que este es el único momento en que se pueden escribir.
--
-- Sin clave ajena, por coherencia con `creado_por`, que hoy tampoco la tiene. Y
-- por delante del bloque de la sección 5, que calcula su lista de columnas
-- leyendo information_schema en tiempo de migración: si estas dos no existieran
-- todavía, quedarían fuera de la lista y por tanto sin proteger.
alter table fin_asientos
  add column if not exists confirmado_por uuid,
  add column if not exists confirmado_en  timestamptz;

-- El centro va en el APUNTE, no en el asiento: un mismo asiento puede repartir
-- una factura entre varios centros, y de hecho es lo normal en una compra
-- centralizada. Ponerlo en la cabecera obligaría a partir el asiento.
--
-- Decidido por Luis el 17-08-2026, y decidido AHORA por una razón de plazo, no
-- de gana: hoy fin_apuntes está a 0 filas y esto son dos líneas. Con un
-- ejercicio contabilizado dentro, añadirlo obliga a repartir a mano miles de
-- apuntes ya cerrados e inmutables, y nadie puede reconstruir a posteriori a qué
-- centro fue cada gasto.
--
-- Es opcional a propósito: las cuentas de balance (tesorería, clientes,
-- proveedores) no tienen centro que valga, y forzarlo llevaría a inventarse uno.
-- Lo que sí lo necesita es el resultado — los grupos 6 y 7 —, que es de donde
-- sale la PyG por centro y donde tiene que aterrizar el centro_id que la F2c ya
-- puso en fin_activos para que la amortización caiga en su centro.
alter table fin_apuntes
  add column if not exists centro_id uuid references centros(id);

create index if not exists fin_apuntes_centro_idx on fin_apuntes (centro_id);

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

  -- El rastro se escribe AQUÍ porque es el único sitio donde se puede escribir.
  -- La sección 5 revoca el UPDATE de estas cuatro columnas, y el INSERT sigue
  -- siendo de tabla completa, así que salen dos consecuencias:
  --   · un creado_por que nazca nulo se queda nulo PARA SIEMPRE — ya nadie tiene
  --     privilegio para rellenarlo después, salvo con la service key;
  --   · y lo que venga en el insert no es de fiar: se podría insertar un borrador
  --     con el creado_por de otro, o con confirmado_* inventados. En un asiento
  --     que luego se confirma se sobreescriben; en un borrador que se queda ahí,
  --     no.
  --
  -- coalesce y no asignación directa: con un JWT manda auth.uid() y no lo que
  -- traiga el cuerpo, pero un insert de servidor con la service key no lleva JWT
  -- y allí auth.uid() es nulo — en ese caso vale lo que venga.
  new.creado_por     := coalesce(auth.uid(), new.creado_por);
  new.creado_en      := now();
  new.confirmado_por := null;
  new.confirmado_en  := null;

  return new;
end $$;

create or replace trigger fin_asientos_nacer_borrador_ins before insert on fin_asientos
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
      -- UPDATE y acceso SQL directo podría ponérsela él y hacer el update a
      -- mano. La barrera está en la SECCIÓN 5: sin privilegio de UPDATE sobre
      -- estas dos columnas, ese intento se para antes de llegar aquí. Esta
      -- comprobación se queda porque el error de permisos de Postgres no dice a
      -- quién hay que preguntar, y este mensaje sí.
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

create or replace trigger fin_asientos_proteger_upd before update on fin_asientos
  for each row execute function fin_asientos_proteger();
create or replace trigger fin_asientos_proteger_del before delete on fin_asientos
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
-- intervienen dos asientos, se piden los dos bloqueos por separado y siempre el
-- de id menor primero, que impone el mismo orden a las dos transacciones sin
-- depender de la forma del plan.
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
  -- Los dos bloqueos, pedidos uno a uno y siempre el menor primero. Un
  -- `where id in (…) order by id for share` también funciona, pero se apoya en
  -- que el nodo LockRows quede por encima del Sort — y lo que se está evitando
  -- aquí es precisamente un interbloqueo, así que no conviene que dependa de la
  -- forma del plan. Así las dos transacciones piden los mismos bloqueos en el
  -- mismo orden, y eso no lo decide el planificador.
  if v_viejo is not null and v_nuevo is not null and v_viejo <> v_nuevo then
    perform 1 from fin_asientos where id = least(v_viejo, v_nuevo) for share;
    perform 1 from fin_asientos where id = greatest(v_viejo, v_nuevo) for share;
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

create or replace trigger fin_apuntes_proteger_ins before insert on fin_apuntes
  for each row execute function fin_apuntes_proteger();
create or replace trigger fin_apuntes_proteger_upd before update on fin_apuntes
  for each row execute function fin_apuntes_proteger();
create or replace trigger fin_apuntes_proteger_del before delete on fin_apuntes
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
  v_otro     bigint;
  v_otro_anio fin_ejercicios.anio%type;
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
  -- Y a la CUENTA, que es otra comprobación y no la misma. La RLS de fin_asientos
  -- solo mira cuenta_id, y sociedad_id no está atado a él por ninguna clave ajena
  -- compuesta: un usuario de la cuenta A puede insertar un asiento con
  -- cuenta_id = A (se lo exige la RLS) y la sociedad y el ejercicio de la cuenta
  -- B. El permiso de arriba pasa, y la comprobación de sociedad también, porque
  -- asiento y ejercicio son los dos de B. El asiento acabaría numerado dentro de
  -- la serie del diario de B, que no lo verá nunca porque su RLS filtra por su
  -- cuenta. Es el mismo agujero que esta migración cierra en los apuntes con
  -- cuenta_id, un nivel más arriba.
  --
  -- Queda un residuo asumido: esto hereda la coherencia del propio ejercicio,
  -- cuyo par (cuenta, sociedad) tampoco tiene clave ajena compuesta. Los
  -- ejercicios los da de alta administración, no el usuario.
  if v_ej.cuenta_id <> v_a.cuenta_id then
    raise exception 'El ejercicio % no pertenece a la cuenta del asiento', v_ej.anio;
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

  -- Y el CENTRO del apunte tiene que ser de la sociedad del asiento. La clave
  -- ajena de la sección 1 solo garantiza que el centro EXISTE, no de quién es.
  --
  -- Y no basta con la que ya trae `centros`: esa tabla sí tiene una FK compuesta
  -- —(sociedad_id, cuenta_id) → sociedades(id, cuenta_id)—, o sea que el centro es
  -- coherente CONSIGO MISMO. Lo que no hay es nada que lo ate a la sociedad del
  -- ASIENTO, y eso es lo que se comprueba aquí. Referenciar por uuid un centro
  -- que la RLS ni te deja ver sigue siendo posible: la clave ajena solo exige que
  -- la fila esté, no que la veas.
  --
  -- Sin esto, un apunte de la sociedad A puede imputar su gasto a un centro de la
  -- B, y como de ahí sale la PyG por centro, el resultado del centro ajeno queda
  -- contaminado — y confirmado e inmutable, así que solo se arregla con un asiento
  -- de corrección.
  --
  -- Es el mismo agujero que se cierra arriba con el ejercicio y con las cuentas
  -- del plan, en la dimensión que esta misma migración estrena: al añadir
  -- centro_id se añadió también la forma de colarlo, y por eso se cierra en la
  -- misma migración y no en la siguiente.
  --
  -- Se compara contra la SOCIEDAD y no contra la cuenta a propósito: una cuenta
  -- puede tener varias sociedades, y un centro de la sociedad hermana también
  -- descuadraría la PyG. Los apuntes sin centro no entran, porque el join los
  -- deja fuera — y eso es lo que se quiere: el centro es opcional a propósito.
  select count(*) into v_ajenas
    from fin_apuntes ap
    join centros ce on ce.id = ap.centro_id
   where ap.asiento_id = v_a.id
     and ce.sociedad_id is distinct from v_a.sociedad_id;
  if v_ajenas > 0 then
    raise exception 'Hay % apunte(s) con centro de otra sociedad', v_ajenas;
  end if;

  -- El índice fin_asientos_origen_unico de la sección 6 es la barrera de verdad;
  -- esto es solo el mensaje. Sin esto, contabilizar dos veces la misma factura
  -- devuelve el «duplicate key value violates unique constraint» de Postgres, con
  -- el uuid a pelo: no dice ni en qué asiento está ya contabilizada ni qué hacer,
  -- y es el único rechazo de esta función que no estaría en castellano.
  --
  -- No es a prueba de carreras y no pretende serlo: el advisory lock de abajo
  -- serializa por ejercicio y esta unicidad es global, así que dos confirmaciones
  -- simultáneas del mismo origen en ejercicios distintos pasarían las dos por
  -- aquí. Ahí muerde el índice, que es donde tiene que morder.
  --
  -- Esta lista de tipos tiene que moverse con la del índice de la sección 6.
  --
  -- Dos decisiones dentro de la consulta:
  --   · Se filtra por cuenta_id porque esta función corre SIN RLS, y sin el
  --     filtro el mensaje podría revelar el número de asiento de otro inquilino.
  --     Consecuencia asumida: un duplicado ENTRE inquilinos daría el error crudo
  --     del índice, no este mensaje — pero exigiría que dos inquilinos compartan
  --     un origen_id, que es un uuid: no ocurre.
  --   · Se dice también el ejercicio, porque `numero` solo es único dentro de
  --     uno: «el asiento 47» a secas no dice de qué año habla, y el caso que el
  --     advisory lock no cubre es justamente el de dos ejercicios distintos.
  if v_a.origen_id is not null
     and v_a.origen_tipo in ('factura_emitida', 'compra') then
    select a.numero, e.anio into v_otro, v_otro_anio
      from fin_asientos a
      join fin_ejercicios e on e.id = a.ejercicio_id
     where a.origen_tipo = v_a.origen_tipo
       and a.origen_id   = v_a.origen_id
       and a.estado      = 'confirmado'
       and a.cuenta_id   = v_a.cuenta_id
       and a.id         <> v_a.id
     limit 1;
    if found then
      raise exception 'Este origen (%) ya está contabilizado en el asiento % del ejercicio %',
        v_a.origen_tipo, v_otro, v_otro_anio;
    end if;
  end if;

  -- Numeración correlativa por ejercicio: reinicia en 1 cada año, y no deja
  -- huecos porque sale de max()+1 sobre lo ya comprometido — una secuencia sí
  -- los dejaría, porque un rollback no devuelve el número consumido.
  --
  -- Va por ORDEN DE CONFIRMACIÓN, no por fecha: un asiento de enero confirmado
  -- en marzo se lleva número posterior a otro de febrero confirmado antes.
  -- Decidido con Luis el 17-08-2026: se acepta durante el ejercicio y el diario
  -- se RENUMERA POR FECHA al cerrarlo. Esa renumeración toca asientos
  -- confirmados, que aquí son inmutables, así que tiene que vivir dentro de la
  -- función de cierre de ejercicio (F5d) y dejar rastro — nunca un update suelto.
  --
  -- CÓMO LO HARÁ LA F5d, para que quien la escriba no busque un atajo: no tiene
  -- que desactivar el disparador (eso es de sesión, no de transacción: con
  -- concurrencia deja de proteger a todos) ni reabrir esta migración. Basta un
  -- `create or replace function fin_asientos_proteger()` en la propia F5d que
  -- añada su rama, que es como se evolucionan las funciones de disparador y lo
  -- que ya manda la regla de la casa: una migración aplicada no se edita, los
  -- cambios van en una nueva. Aquí no se deja preparada ninguna puerta para eso
  -- a propósito — un hueco abierto hoy en la guarda de inmutabilidad, para una
  -- función que todavía no existe, es más riesgo que el que ahorra.
  --
  -- La numeración se apoya en READ COMMITTED, que es lo que hay. Bajo
  -- REPEATABLE READ el max() saldría de una instantánea anterior al lock y
  -- chocaría contra fin_asientos_numero_unico: falla en seguro (error, ni hueco
  -- ni duplicado), pero conviene que esté escrito.
  --
  -- El lock serializa dos confirmaciones
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

  -- auth.uid() funciona dentro de SECURITY DEFINER: lee la reclamación del JWT de
  -- la petición, no el rol con el que se ejecuta la función.
  update fin_asientos
     set numero         = v_numero,
         estado         = 'confirmado',
         confirmado_por = auth.uid(),
         confirmado_en  = now()
   where id = v_a.id;

  -- La marca ya ha hecho su trabajo. Hoy es inocuo dejarla puesta — el asiento
  -- pasa a confirmado y la rama de borrador no vuelve a entrar —, pero una marca
  -- viva durante el resto de la transacción es una invitación a un accidente.
  perform set_config('fin.confirmando', '', true);

  return jsonb_build_object(
    'numero', v_numero,
    'fecha',  to_char(v_a.fecha, 'DD-MM-YYYY'),
    'debe',   v_debe,
    'haber',  v_haber
  );
end $$;

-- El mismo cinturón que la F1b puso a expedir y anular: que anon no pueda ni
-- llamarla. Hacen falta las DOS revocaciones, y por eso allí hicieron falta dos
-- migraciones: Postgres concede EXECUTE a PUBLIC en toda función nueva, y
-- Supabase concede además EXECUTE a anon explícitamente. anon es miembro de
-- PUBLIC, así que quitar una no quita la otra. Comprobado en la base: las 18
-- funciones fin_* llevan las dos concesiones; las únicas limpias son
-- fin_expedir_factura y fin_anular_factura, que pasaron por F1a (public) y F1b
-- (anon). (Por dentro ya se comprueba cuenta_actual(), que para un anónimo es
-- nulo; esto es la segunda capa.)
revoke execute on function fin_confirmar_asiento(uuid) from public, anon;

-- ----------------------------------------------------------------------------
-- 5) La puerta cerrada, no el cartel de «no pasar»
--
-- La marca `fin.confirmando` de la sección 2 es un guardarraíl: impide el update
-- accidental, pero quien tenga acceso SQL directo puede ponérsela él mismo.
-- Esto es la barrera de verdad: sin permiso de UPDATE sobre `estado` y `numero`,
-- da igual lo que intente — lo para el motor antes de llegar a ningún
-- disparador. Las dos capas se quedan: los privilegios impiden, la marca explica
-- por qué (el error de permisos de Postgres no dice a quién preguntar).
--
-- OJO al detalle que hace que esto funcione: un `revoke update (estado, numero)`
-- NO sirve mientras exista el grant a nivel de TABLA. Hay que revocar la tabla
-- entera y volver a conceder columna a columna.
--
-- La lista se calcula, no se escribe a mano: se conceden todas las columnas
-- MENOS las protegidas. Consecuencia buscada de hacerlo en tiempo de migración:
-- una columna añadida más adelante no queda concedida, y la app falla con
-- «permission denied for column», que es ruidoso y se arregla en un minuto. Lo
-- contrario — que se concediera sola — sería silencioso, y silencioso es peor.
--
-- fin_confirmar_asiento sigue pudiendo escribirlas porque es SECURITY DEFINER y
-- corre como el propietario de la tabla, que conserva todos los privilegios.
--
-- Y NO es absoluto, conviene no leerlo así: `service_role` conserva el UPDATE de
-- tabla (comprobado). La puerta queda cerrada para authenticated y para anon, que
-- son los roles con los que entra la app. Cualquier código de servidor que use la
-- service key sigue pudiendo escribir estado y numero a mano — razón de más para
-- que esa clave no salga nunca del sitio donde vive.
-- ----------------------------------------------------------------------------

-- TRUNCATE se lleva por delante todo lo anterior: no pasa por los disparadores de
-- fila (solo por los de sentencia, que aquí no hay) y tampoco por la RLS. Un
-- `truncate fin_asientos cascade` vacía el diario entero —confirmados incluidos y
-- de todos los inquilinos— sin que salte ninguna guarda de las secciones 2 y 3.
-- Comprobado en la base el 17-08-2026: anon y authenticated tienen el privilegio,
-- porque el grant por defecto de Supabase es arwdDxtm y la D es TRUNCATE.
--
-- Hoy no es alcanzable desde la app —PostgREST no expone TRUNCATE y ninguno de los
-- dos roles es de conexión—, y por eso es lo mismo que hace el resto de esta
-- sección: quitar el privilegio que nadie usa, para que la inmutabilidad no
-- dependa de que el cliente siga siendo PostgREST.
--
-- El mismo grant está en TODAS las tablas del proyecto. Limpiarlo entero es una
-- migración de higiene aparte; aquí se quita solo en las dos tablas cuya
-- inmutabilidad promete esta migración.
revoke truncate on fin_asientos, fin_apuntes from anon, authenticated;

do $$
declare
  v_columnas   text;
  v_protegidas int;
begin
  -- anon no escribe asientos en ningún caso: se le quita entero, sin devolverle
  -- nada. Mismo criterio que la F1b con expedir y anular.
  revoke update on fin_asientos from authenticated, anon;

  -- La lista de exclusión de abajo es un `not in`: si una de estas columnas se
  -- renombrara, no fallaría — simplemente saldría de la exclusión y quedaría
  -- CONCEDIDA. Este archivo presume de fallar de forma ruidosa, y por ese lado
  -- fallaba en silencio y de menos a más. La aserción lo cierra.
  select count(*) into v_protegidas
    from information_schema.columns
   where table_schema = 'public' and table_name = 'fin_asientos'
     and column_name in ('id','cuenta_id','sociedad_id','numero','estado',
                         'creado_por','creado_en','confirmado_por','confirmado_en');
  if v_protegidas <> 9 then
    raise exception 'Esperaba 9 columnas protegidas en fin_asientos y encuentro %: revisar la lista de exclusión', v_protegidas;
  end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_columnas
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'fin_asientos'
     and column_name not in (
       'id',           -- mover un asiento de sitio no es editarlo
       'cuenta_id',    -- cambiarlo se lo lleva a otro inquilino
       'sociedad_id',  -- y esto, a otra sociedad del mismo inquilino
       'numero',       -- los asigna
       'estado',       --   fin_confirmar_asiento()
       'creado_por',      -- rastro de quién y cuándo: no se reescribe
       'creado_en',
       'confirmado_por',  -- los escribe fin_confirmar_asiento()
       'confirmado_en'    --   y nadie más
     );

  execute format('grant update (%s) on fin_asientos to authenticated', v_columnas);
end $$;

-- ----------------------------------------------------------------------------
-- 6) Un origen no se contabiliza dos veces
--
-- origen_tipo y origen_id existen desde la F0 y no tenían ningún índice único:
-- en fin_asientos solo estaban la clave primaria, fin_asientos_numero_unico y
-- (sociedad_id, fecha). Mientras los asientos se teclean a mano da igual, pero
-- en cuanto exista la contabilización automática dos llamadas sobre la misma
-- factura darían dos asientos confirmados e inmutables con el mismo ingreso, y
-- la única salida sería un asiento de corrección.
--
-- Decidido por Luis el 17-08-2026: entra aquí y no en la migración de la
-- contabilización, porque hoy la tabla está a cero filas y crear el índice es
-- gratis. Más tarde habría que comprobar antes que no haya ya duplicados.
--
-- Tres decisiones dentro del índice:
--   · `estado = 'confirmado'` deja convivir varios borradores del mismo origen
--     y solo muerde al confirmar, que es cuando el hecho pasa a ser contable.
--   · `origen_id is not null` deja fuera los asientos manuales, que no tienen
--     origen y son la mayoría hoy.
--   · Solo los tipos donde la relación es de VERDAD uno a uno. apertura,
--     regularizacion y cierre quedan fuera porque un cierre de ejercicio genera
--     legítimamente más de un asiento con el mismo origen_id; y banco, hasta
--     saber qué va a apuntar ahí.
-- ----------------------------------------------------------------------------

-- Si aquí se añade un tipo, hay que añadirlo también a la comprobación previa de
-- la sección 4 que da el mensaje en castellano. Son dos capas de lo mismo y
-- tienen que llevar la misma lista.
create unique index if not exists fin_asientos_origen_unico
  on fin_asientos (origen_tipo, origen_id)
  where origen_id is not null
    and estado = 'confirmado'
    and origen_tipo in ('factura_emitida', 'compra');

-- OJO si algún día se amplía la lista de exclusión: NO puede llegar a cubrir
-- todas las columnas. Un `select … for share` o `for update` exige privilegio de
-- UPDATE sobre al menos una columna de la tabla; sin ninguna concedida,
-- authenticated dejaría de poder pedir esos bloqueos. Comprobado en la base: con
-- UPDATE sobre dos columnas el `for share` pasa, y sin ninguna falla con
-- «permission denied for table fin_asientos». Hoy quedan cinco concedidas
-- (ejercicio_id, fecha, descripcion, origen_tipo, origen_id) y las funciones que
-- bloquean son SECURITY DEFINER, así que no muerde — pero es de las cosas que se
-- descubren tarde.

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
--   · `truncate fin_asientos` como authenticated ............... debe FALLAR
--     (permiso denegado, no disparador: es justo lo que se cierra)
--   · Confirmar con un apunte con centro de OTRA sociedad ...... debe FALLAR
--   · Insertar ese mismo apunte estando en borrador ............ debe PASAR
--     (el centro se valida al confirmar, no al insertar: está escrito para que
--      no se lea como un olvido)
--   · Confirmar dos veces el mismo origen (misma factura) ...... debe FALLAR
--     con el mensaje en castellano, no con el del índice único
--   · Mover un apunte de un asiento a otro, los dos borradores . debe PASAR
--   · Borrar un asiento EN BORRADOR que tiene apuntes ......... debe PASAR
--     (este es el caso que falló en facturas y motivó la F0b; aquí el trigger
--      de apuntes distingue «sin padre» de «padre no borrador»)
-- ============================================================================
