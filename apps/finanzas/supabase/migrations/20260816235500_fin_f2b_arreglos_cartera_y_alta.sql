-- ESTADO: PROPUESTA. No aplicada. Para revisión de Luis.
-- ============================================================================
-- MIGRACIÓN F2b — Una factura solo puede nacer como borrador, y arreglos de F2a
-- Proyecto: hostelero · Fecha: 16-08-2026
--
-- ============================================================================
-- 1) LO IMPORTANTE: el núcleo fiscal se podía saltar por completo
-- ============================================================================
--
-- La F0 protege las facturas expedidas con fin_facturas_proteger, pero ese
-- disparador es BEFORE UPDATE y BEFORE DELETE. El INSERT no lo cubría nadie.
--
-- Comprobado ejecutándolo como `authenticated` con la sesión de un usuario real
-- (en transacción con rollback): se puede insertar una fila con
-- estado = 'expedida', número inventado y fecha de expedición, sin pasar por
-- fin_expedir_factura. Resultado: factura expedida a todos los efectos de la
-- app, con CERO registros Verifactu. Lo mismo con estado = 'anulada'.
--
-- Por qué importa aunque hoy solo entre Luis: la cadena de huellas debe
-- contener TODAS las facturas expedidas del obligado. Una factura expedida sin
-- su registro rompe esa promesa, y es justo lo que el reglamento exige que un
-- SIF no permita. No hace falta mala fe: basta un error de la app o un usuario
-- nuevo con permiso de escritura.
--
-- La corrección: una factura solo puede nacer BORRADOR y sin número. Expedir
-- es siempre un UPDATE, y solo lo hace fin_expedir_factura.
--
-- Nota para el futuro: si algún día hay que cargar facturas históricas ya
-- expedidas (por ejemplo, las de Ágora), habrá que desactivar este disparador
-- dentro de la propia migración de carga y volver a activarlo. Que sea
-- incómodo es intencionado.
-- ----------------------------------------------------------------------------

create or replace function fin_facturas_nacer_borrador() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.estado is distinct from 'borrador' then
    raise exception
      'Una factura solo puede crearse como borrador (se intentó crear como %). Para expedir se usa fin_expedir_factura.',
      new.estado;
  end if;

  if new.numero is not null or new.numero_completo is not null or new.fecha_expedicion is not null then
    raise exception
      'El número y la fecha de expedición los asigna fin_expedir_factura, no se pueden traer puestos';
  end if;

  return new;
end $$;

drop trigger if exists fin_facturas_nacer_borrador on fin_facturas;
create trigger fin_facturas_nacer_borrador
  before insert on fin_facturas
  for each row execute function fin_facturas_nacer_borrador();

-- ============================================================================
-- 2) Arreglos de la F2a
-- ============================================================================

-- 2.1) forma_pago del vencimiento automático nacía SIEMPRE nula: la variable
-- v_forma se declaraba y nunca se asignaba. Se ha comprobado el esquema real:
-- fin_clientes NO tiene ninguna columna de forma de pago, así que la opción
-- honesta es quitar la variable, no inventarse de dónde sacarla. Un campo que
-- siempre vale nulo confunde más que no tenerlo.
--
-- Si algún día se quiere forma de pago por cliente, será su propia migración,
-- con su columna en fin_clientes y su hueco en la pantalla de clientes.

create or replace function fin_vencimiento_al_expedir() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dias int;
begin
  if new.estado = 'expedida' and old.estado = 'borrador' then
    select coalesce(dias_vencimiento, 0) into v_dias
      from fin_clientes where id = new.cliente_id;

    insert into fin_vencimientos (
      cuenta_id, sociedad_id, sentido, factura_id, fecha_vencimiento, importe
    ) values (
      new.cuenta_id, new.sociedad_id, 'cobro', new.id,
      coalesce(new.fecha_expedicion::date, current_date) + coalesce(v_dias, 0),
      new.total
    );
  end if;

  if new.estado = 'anulada' and old.estado = 'expedida' then
    update fin_vencimientos
       set estado = 'anulado'
     where factura_id = new.id
       and estado in ('pendiente','parcial');
  end if;

  return new;
end $$;

-- 2.2) Los disparadores _tocar de la F2a se creaban sin `drop if exists`, así
-- que un segundo pase de la migración reventaba a mitad. Se rehacen bien.

drop trigger if exists fin_proveedor_condiciones_tocar on fin_proveedor_condiciones;
create trigger fin_proveedor_condiciones_tocar before update on fin_proveedor_condiciones
  for each row execute function fin_tocar_actualizado();

drop trigger if exists fin_vencimientos_tocar on fin_vencimientos;
create trigger fin_vencimientos_tocar before update on fin_vencimientos
  for each row execute function fin_tocar_actualizado();

-- 2.3) Dos claves ajenas se quedaron sin índice de cobertura. Lo dice el
-- linter de Supabase y ya se corrigió lo mismo en su día en `higiene_indices_fk`.

create index if not exists fin_proveedor_condiciones_cuenta_idx
  on fin_proveedor_condiciones (cuenta_id);

create index if not exists fin_vencimientos_sociedad_idx
  on fin_vencimientos (sociedad_id);

-- ============================================================================
-- 3) Revisado y descartado: partir las políticas FOR ALL
-- ============================================================================
-- Se planteó si las políticas de las tablas nuevas debían partirse por acción,
-- como sugiere la migración antigua `higiene_politicas_nucleo_sin_all`.
-- Comprobado en el catálogo: esa decisión se aplicó al NÚCLEO (cuentas,
-- perfiles, sociedades, que tienen políticas separadas de select/insert/update/
-- delete), mientras que TODAS las tablas fin_*, empezando por las de la F0, usan
-- una sola política FOR ALL. Las nuevas siguen la convención de su familia.
-- Si algún día se cambia, se cambia entero, no tabla a tabla.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- PROBADA antes de proponerla, como `authenticated` y con la sesión de un
-- usuario real, en transacción con rollback (16-08-2026):
--
--   Insertar una factura ya 'expedida' con número inventado .. rechazada ✓
--   Insertar una factura ya 'anulada' ....................... rechazada ✓
--   Insertar un borrador con el número puesto ............... rechazada ✓
--   Alta normal de borrador + fin_expedir_factura ........... F-2026-000001,
--     con su vencimiento a hoy+15 (los días que tenía el cliente) ✓
--
-- El último es el que importa tanto como los otros tres: había que comprobar
-- que cerrar el INSERT no rompe el único camino que debe funcionar.
-- ----------------------------------------------------------------------------
