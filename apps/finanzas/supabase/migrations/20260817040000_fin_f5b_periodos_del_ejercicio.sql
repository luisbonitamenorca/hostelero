-- ESTADO: PROPUESTA. No aplicada. Para revisión de Luis.
--
-- NOTA DE ORDEN: la F5a quedó registrada como 20260817112052, así que en un
-- entorno nuevo esta F5b (20260817040000) se ejecuta ANTES que la F5a. No rompe
-- nada — solo toca fin_ejercicios y fin_periodos y no depende de ningún objeto
-- de la F5a — pero conviene saberlo al leer la carpeta.
-- ============================================================================
-- MIGRACIÓN F5b — Un ejercicio nace con sus doce periodos
-- Proyecto: hostelero · Fecha: 17-08-2026
--
-- POR QUÉ
-- fin_periodos es lo que permite cerrar un mes (`bloqueado`), y la F5a exige
-- que exista la fila del mes para poder confirmar un asiento. Hoy los doce
-- periodos del ejercicio 2026 se sembraron a mano, después de aplicar la F0.
-- Mientras eso dependa de que alguien se acuerde, antes o después habrá un
-- ejercicio a medias, y el fallo aparecerá lejos de donde se causó: al
-- contabilizar, meses más tarde, y con cara de problema del asiento.
--
-- Esta migración lo mueve al sitio donde nace: dar de alta el ejercicio.
--
-- REPARTO CON LA F5a
-- Son dos capas de lo mismo, a propósito:
--   · Aquí se garantiza que los periodos existan.
--   · En la F5a, si aun así faltara la fila, confirmar falla con un mensaje que
--     señala la configuración del ejercicio.
-- La primera evita el problema; la segunda impide que, si ocurre, el bloqueo
-- mensual se apague en silencio.
--
-- ESTADO COMPROBADO ANTES DE ESCRIBIRLA (17-08-2026, contra producción)
--   · fin_periodos tiene exactamente: id, cuenta_id, ejercicio_id, mes,
--     bloqueado. No hay fechas de inicio/fin que derivar del ejercicio.
--   · bloqueado es NOT NULL con default false; mes tiene check 1..12.
--   · Existe el unique (ejercicio_id, mes) que la F5a da por hecho.
--   · Hay 1 ejercicio (2026) y tiene sus 12 periodos: NO hace falta backfill.
--     El insert de recuperación de abajo se deja igualmente, porque cuesta
--     nada y deja el sistema coherente si esto se aplicara en otro entorno.
-- ============================================================================

create or replace function fin_ejercicios_sembrar_periodos() returns trigger
language plpgsql set search_path = public as $$
begin
  -- cuenta_id se hereda del ejercicio: es lo que hace que la RLS de fin_periodos
  -- (el patrón de la casa) vea estas filas como de la misma cuenta.
  insert into fin_periodos (cuenta_id, ejercicio_id, mes)
  select new.cuenta_id, new.id, g
  from generate_series(1, 12) as g
  on conflict (ejercicio_id, mes) do nothing;

  return new;
end $$;

-- `or replace` por lo mismo que la ronda 9 lo puso en los seis de la F5a: es lo
-- único que impediría reejecutar el archivo entero.
create or replace trigger fin_ejercicios_sembrar_periodos_ins after insert on fin_ejercicios
  for each row execute function fin_ejercicios_sembrar_periodos();

-- Recuperación de lo que ya existiera incompleto. Con `on conflict do nothing`
-- no toca los periodos ya sembrados, así que no puede desbloquear un mes que
-- alguien hubiera cerrado: solo añade los que faltan.
insert into fin_periodos (cuenta_id, ejercicio_id, mes)
select e.cuenta_id, e.id, g
from fin_ejercicios e
cross join generate_series(1, 12) as g
on conflict (ejercicio_id, mes) do nothing;

-- ============================================================================
-- COMPROBACIONES SUGERIDAS DESPUÉS DE APLICAR
--
--   · Que el ejercicio 2026 sigue teniendo 12 periodos y NINGUNO ha cambiado
--     su estado de bloqueado:
--       select mes, bloqueado from fin_periodos
--        where ejercicio_id = (select id from fin_ejercicios where anio = 2026)
--        order by mes;
--
--   · Dentro de `begin; … rollback;`, crear un ejercicio nuevo y comprobar que
--     nace con sus doce:
--       insert into fin_ejercicios (cuenta_id, sociedad_id, anio, fecha_inicio, fecha_fin)
--       values (…, …, 2027, '2027-01-01', '2027-12-31');
--       select count(*) from fin_periodos
--        where ejercicio_id = (select id from fin_ejercicios where anio = 2027);
--       -- debe dar 12
-- ============================================================================
