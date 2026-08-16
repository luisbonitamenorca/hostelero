-- ESTADO: PROPUESTA. La ÚNICA sin aplicar. Para revisión de Luis.
--
-- Llevaba el número 20260816130000, que la ponía por delante de la F1a. Como no
-- está aplicada, un entorno nuevo levantado desde el repo la habría ejecutado en
-- un orden distinto al de producción: repo y producción dejaban de ser el mismo
-- sistema. Renumerada al final para que ese riesgo desaparezca mientras se
-- decide si se aplica.
-- ============================================================================
-- MIGRACIÓN F0b — Arreglo: borrar un borrador con líneas era imposible
-- Proyecto: hostelero · Fecha: 16-08-2026
--
-- EL PROBLEMA (verificado contra producción en una transacción con rollback)
-- fin_factura_lineas y fin_factura_impuestos cuelgan de fin_facturas con
-- `on delete cascade`, y las protege fin_lineas_proteger(), que ante un DELETE
-- busca la factura padre para comprobar que sigue en borrador:
--
--     select estado into v_estado from fin_facturas where id = old.factura_id;
--     if v_estado is distinct from 'borrador' then raise exception ...
--
-- Cuando el borrado nace de la cabecera, Postgres borra primero la fila padre
-- y después dispara el cascade sobre las hijas. Para entonces el SELECT ya no
-- encuentra nada, v_estado es NULL, y NULL is distinct from 'borrador' es
-- cierto: el trigger aborta el borrado.
--
-- Efecto: un borrador sin líneas se borra; uno con líneas, NUNCA. Y el usuario
-- ve un mensaje que además miente ("factura expedida" sobre un borrador).
--
-- LA CORRECCIÓN
-- Si la factura padre ya no existe, este DELETE sólo puede venir del cascade de
-- un borrado de cabecera que fin_facturas_proteger() ya autorizó — y esa
-- función únicamente deja borrar borradores. Así que dejarlo pasar no abre
-- ninguna puerta: la de verdad se sigue guardando arriba.
--
-- Lo que NO cambia: sobre una factura que existe y no es borrador, el trigger
-- sigue rechazando cualquier INSERT, UPDATE o DELETE de líneas. El núcleo
-- fiscal sigue siendo inmutable.
--
-- Mientras esto no se aplique, la app borra las líneas a mano antes que la
-- cabecera (ver borrarBorrador en app/acciones.ts). Aplicar esta migración no
-- rompe ese orden: seguirá funcionando igual.
-- ============================================================================

create or replace function fin_lineas_proteger() returns trigger
language plpgsql set search_path = public as $$
declare
  v_estado text;
begin
  if tg_op in ('UPDATE','DELETE') then
    select estado into v_estado from fin_facturas where id = old.factura_id;

    -- Cascade de un borrado de cabecera ya autorizado: la factura ya no está.
    if not found then
      return old;
    end if;

    if v_estado is distinct from 'borrador' then
      raise exception 'El detalle de una factura expedida es inmutable';
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    select estado into v_estado from fin_facturas where id = new.factura_id;
    if v_estado is distinct from 'borrador' then
      raise exception 'El detalle de una factura expedida es inmutable';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- Comprobación posterior sugerida (en una transacción con rollback):
--
--   begin;
--   insert into fin_facturas (cuenta_id, sociedad_id, serie_id, ejercicio, tipo,
--     descripcion_operacion, estado)
--   values ('<cuenta>', '<sociedad>', '<serie>', 2026, 'F1', 'PRUEBA F0b', 'borrador');
--
--   insert into fin_factura_lineas (cuenta_id, factura_id, orden, concepto,
--     cantidad, precio_unitario, descuento_pct, tipo_iva, tipo_retencion,
--     base, cuota_iva, cuota_retencion, total)
--   select '<cuenta>', id, 1, 'Linea', 1, 10, 0, 21, 0, 10, 2.10, 0, 12.10
--   from fin_facturas where descripcion_operacion = 'PRUEBA F0b';
--
--   delete from fin_facturas where descripcion_operacion = 'PRUEBA F0b';  -- debe funcionar
--   rollback;
-- ----------------------------------------------------------------------------
