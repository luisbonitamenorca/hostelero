-- ESTADO: APLICADA en producción el 16-08-2026 desde el chat de claude.ai.
-- Registrada en Supabase como 20260816182802 (ver nota al pie). No reaplicar.
-- ============================================================================
-- MIGRACIÓN F1a — Expedición y anulación de facturas con registro Verifactu
-- Proyecto: hostelero · Fecha: 16-08-2026
--
-- Qué añade: funciones SECURITY DEFINER fin_expedir_factura y
-- fin_anular_factura, más las funciones de apoyo que construyen la huella y el
-- QR. No crea ni altera ninguna tabla.
--
-- FUENTE DE LA HUELLA Y DEL QR — documentos oficiales de la AEAT, leídos y
-- seguidos al pie de la letra (no de memoria):
--   · "Detalle de las especificaciones técnicas para generación de la huella o
--     hash de los registros de facturación", AEAT, v0.1.2, 27/08/2024.
--   · "Detalle de las especificaciones técnicas del código QR de la factura",
--     AEAT, v0.5.0.
-- Los tres vectores de ejemplo del documento de la huella se reproducen exactos
-- con estas funciones; la comprobación está al final del archivo para poder
-- repetirla después de aplicar.
--
-- IMPORTETOTAL CON RETENCIÓN — RESUELTO, con fuente:
-- "Aclaraciones a dudas de los desarrolladores", AEAT, 04/12/2025, apartado 20
-- ("Concepto «Importe total» en el registro de facturación"):
--
--   ImporteTotal = Σ (BaseImponibleOimporteNoSujeto + CuotaRepercutida
--                     + CuotaRecargoEquivalencia) de las líneas de desglose.
--
--   "En conclusión la retención a cuenta del IRPF o IS que vaya en factura, no
--    se incluirá en el registro de facturación, ya que no es uno de los
--    elementos constitutivos de la factura."
--
-- Es decir: el IRPF, los suplidos y el recargo financiero alteran el "total a
-- pagar", pero NO el "Importe total factura". Por eso aquí ImporteTotal es
-- base + cuota de IVA, y el total a pagar (que sí resta el IRPF) se guarda
-- aparte en fin_facturas.total. La AEAT valida ese importe con un margen de
-- ±10 €, y el mismo valor es el que viaja en el QR.
--
-- Consecuencia para el PDF (tarea 7): la propia AEAT recomienda que la factura
-- muestre AMBOS importes, etiquetados y distinguidos — "Total factura" (el del
-- QR) y "Total a pagar" —, porque es lo que verá el cliente al cotejar el QR.
--
-- Lo que sí queda fuera de alcance hoy: el recargo de equivalencia, que suma a
-- ImporteTotal cuando aplica. No se factura con recargo en Bonita; si algún día
-- se hace, hay que añadirlo a esta suma.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Apoyo: formatos exigidos por la especificación
-- ----------------------------------------------------------------------------

-- Importes de la cadena de huella y del QR: punto decimal, dos posiciones, sin
-- separador de miles y sin relleno. La especificación admite una o dos
-- posiciones decimales indistintamente; se emiten siempre dos.
create or replace function fin_vf_importe(p numeric) returns text
language sql immutable set search_path = public as $$
  select to_char(coalesce(p, 0), 'FM9999999999999990.00')
$$;

-- Fechas de la cadena y del QR: DD-MM-AAAA.
create or replace function fin_vf_fecha(p date) returns text
language sql immutable set search_path = public as $$
  select to_char(p, 'DD-MM-YYYY')
$$;

-- FechaHoraHusoGenRegistro: ISO 8601 con huso, p. ej. 2024-01-01T19:20:30+01:00.
-- Postgres devuelve el huso como '+01' cuando no hay minutos; la AEAT lo quiere
-- siempre con ':00'.
create or replace function fin_vf_fecha_hora(p timestamptz) returns text
language sql stable set search_path = public set timezone = 'Europe/Madrid' as $$
  select to_char(p, 'YYYY-MM-DD"T"HH24:MI:SS')
      || regexp_replace(to_char(p, 'OF'), '^([+-]\d{2})$', '\1:00')
$$;

-- Un campo de la cadena: nombre=valor, recortando espacios al principio y al
-- final. Si no hay valor, queda el nombre y el '=' sin nada detrás.
create or replace function fin_vf_campo(p_nombre text, p_valor text) returns text
language sql immutable set search_path = public as $$
  select p_nombre || '=' || coalesce(btrim(p_valor), '')
$$;

-- SHA-256 de la cadena en UTF-8, en hexadecimal y mayúsculas (64 caracteres).
create or replace function fin_vf_huella(p_cadena text) returns text
language sql immutable set search_path = public as $$
  select upper(encode(sha256(convert_to(p_cadena, 'UTF8')), 'hex'))
$$;

-- Cadena del registro de ALTA, en el orden exacto de la especificación.
create or replace function fin_vf_cadena_alta(
  p_nif_emisor text, p_num_serie text, p_fecha_expedicion date,
  p_tipo_factura text, p_cuota_total numeric, p_importe_total numeric,
  p_huella_anterior text, p_fecha_hora timestamptz
) returns text
language sql stable set search_path = public as $$
  select concat_ws('&',
    fin_vf_campo('IDEmisorFactura',          p_nif_emisor),
    fin_vf_campo('NumSerieFactura',          p_num_serie),
    fin_vf_campo('FechaExpedicionFactura',   fin_vf_fecha(p_fecha_expedicion)),
    fin_vf_campo('TipoFactura',              p_tipo_factura),
    fin_vf_campo('CuotaTotal',               fin_vf_importe(p_cuota_total)),
    fin_vf_campo('ImporteTotal',             fin_vf_importe(p_importe_total)),
    fin_vf_campo('Huella',                   p_huella_anterior),
    fin_vf_campo('FechaHoraHusoGenRegistro', fin_vf_fecha_hora(p_fecha_hora))
  )
$$;

-- Cadena del registro de ANULACIÓN: cinco campos, sin tipo ni importes.
create or replace function fin_vf_cadena_anulacion(
  p_nif_emisor text, p_num_serie text, p_fecha_expedicion date,
  p_huella_anterior text, p_fecha_hora timestamptz
) returns text
language sql stable set search_path = public as $$
  select concat_ws('&',
    fin_vf_campo('IDEmisorFacturaAnulada',        p_nif_emisor),
    fin_vf_campo('NumSerieFacturaAnulada',        p_num_serie),
    fin_vf_campo('FechaExpedicionFacturaAnulada', fin_vf_fecha(p_fecha_expedicion)),
    fin_vf_campo('Huella',                        p_huella_anterior),
    fin_vf_campo('FechaHoraHusoGenRegistro',      fin_vf_fecha_hora(p_fecha_hora))
  )
$$;

-- «URL encoding» de un valor del QR, en UTF-8 y al estilo formulario web: se
-- dejan tal cual las letras, los dígitos y . - * _ ; el espacio pasa a '+' y
-- todo lo demás a %XX en mayúsculas. Es lo que hace el URLEncoder del ejemplo
-- oficial, y sin esto un número de serie con '&' o '/' rompe la URL.
create or replace function fin_vf_url_encode(p_valor text) returns text
language plpgsql immutable set search_path = public as $$
declare
  v_bytes bytea := convert_to(coalesce(p_valor, ''), 'UTF8');
  v_salida text := '';
  v_byte int;
  v_car text;
  i int;
begin
  for i in 0 .. length(v_bytes) - 1 loop
    v_byte := get_byte(v_bytes, i);
    v_car  := chr(v_byte);
    if v_car ~ '[A-Za-z0-9.*_-]' then
      v_salida := v_salida || v_car;
    elsif v_byte = 32 then
      v_salida := v_salida || '+';
    else
      v_salida := v_salida || '%' || upper(lpad(to_hex(v_byte), 2, '0'));
    end if;
  end loop;
  return v_salida;
end $$;

-- Contenido del QR: URL de cotejo con los cuatro parámetros obligatorios, en
-- este orden. `p_produccion` elige entre el entorno de pruebas externas y el de
-- producción; hasta que una factura de prueba pase por el entorno de la AEAT,
-- esto se llama siempre con false.
create or replace function fin_vf_qr(
  p_nif text, p_num_serie text, p_fecha date, p_importe numeric,
  p_produccion boolean default false
) returns text
language sql stable set search_path = public as $$
  select case when p_produccion
           then 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR'
           else 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR'
         end
      || '?nif='      || fin_vf_url_encode(p_nif)
      || '&numserie='  || fin_vf_url_encode(p_num_serie)
      || '&fecha='     || fin_vf_url_encode(fin_vf_fecha(p_fecha))
      || '&importe='   || fin_vf_url_encode(fin_vf_importe(p_importe))
$$;

-- ----------------------------------------------------------------------------
-- 1) Expedir
-- ----------------------------------------------------------------------------

create or replace function fin_expedir_factura(p_factura_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
set timezone = 'Europe/Madrid'
as $$
declare
  v_f              fin_facturas%rowtype;
  v_serie          fin_series%rowtype;
  v_nif_emisor     text;
  v_lineas         int;
  v_base           numeric(14,2);
  v_cuota_iva      numeric(14,2);
  v_cuota_ret      numeric(14,2);
  v_importe_total  numeric(14,2);
  v_numero         bigint;
  v_numero_completo text;
  v_ahora          timestamptz := now();
  v_fecha_exp      date;
  v_orden          bigint;
  v_huella_ant     text;
  v_cadena         text;
  v_huella         text;
  v_qr             text;
  v_registro_id    uuid;
begin
  -- La factura, bloqueada hasta el final de la transacción.
  select * into v_f from fin_facturas where id = p_factura_id for update;
  if not found then
    raise exception 'La factura no existe';
  end if;

  -- SECURITY DEFINER se salta la RLS: el permiso se comprueba aquí a mano.
  if v_f.cuenta_id is distinct from cuenta_actual() and not es_operador() then
    raise exception 'Sin permiso sobre esta factura';
  end if;

  if v_f.estado <> 'borrador' then
    raise exception 'Solo se expiden borradores (esta factura está %)', v_f.estado;
  end if;

  select count(*) into v_lineas from fin_factura_lineas where factura_id = v_f.id;
  if v_lineas = 0 then
    raise exception 'Una factura sin líneas no se puede expedir';
  end if;

  -- La simplificada (F2) puede no llevar destinatario; el resto, sí.
  if v_f.cliente_id is null and v_f.tipo <> 'F2' then
    raise exception 'Falta el cliente: solo la factura simplificada (F2) puede no llevarlo';
  end if;

  select cif into v_nif_emisor from sociedades where id = v_f.sociedad_id;
  if v_nif_emisor is null or btrim(v_nif_emisor) = '' then
    raise exception 'La sociedad emisora no tiene CIF';
  end if;

  -- Serie bloqueada: dos expediciones simultáneas no pueden tomar el mismo
  -- número. El correlativo sale de aquí y de ningún otro sitio.
  select * into v_serie from fin_series where id = v_f.serie_id for update;
  if not found then
    raise exception 'La serie de la factura no existe';
  end if;
  if not v_serie.activa then
    raise exception 'La serie % está desactivada', v_serie.codigo;
  end if;

  v_numero := v_serie.siguiente_numero;
  update fin_series set siguiente_numero = siguiente_numero + 1 where id = v_serie.id;

  -- Totales recalculados desde las líneas: lo que trajera la cabecera es
  -- orientativo. Redondeo por línea, ya aplicado al guardar cada línea.
  select coalesce(sum(base), 0), coalesce(sum(cuota_iva), 0), coalesce(sum(cuota_retencion), 0)
    into v_base, v_cuota_iva, v_cuota_ret
    from fin_factura_lineas where factura_id = v_f.id;

  -- Desglose por tipo impositivo: se rehace entero mientras aún es borrador.
  delete from fin_factura_impuestos where factura_id = v_f.id;

  insert into fin_factura_impuestos (cuenta_id, factura_id, impuesto, tipo_pct, base, cuota)
  select v_f.cuenta_id, v_f.id, 'IVA', tipo_iva, sum(base), sum(cuota_iva)
    from fin_factura_lineas where factura_id = v_f.id
   group by tipo_iva;

  insert into fin_factura_impuestos (cuenta_id, factura_id, impuesto, tipo_pct, base, cuota)
  select v_f.cuenta_id, v_f.id, 'IRPF', tipo_retencion, sum(base), sum(cuota_retencion)
    from fin_factura_lineas where factura_id = v_f.id and tipo_retencion <> 0
   group by tipo_retencion;

  v_numero_completo := v_serie.codigo || '-' || v_serie.ejercicio || '-' || lpad(v_numero::text, 6, '0');
  v_fecha_exp := v_ahora::date;

  -- ImporteTotal del registro = base + cuota de IVA. El IRPF NO entra: lo dice
  -- el apartado 20 de las aclaraciones de la AEAT (ver cabecera). El total a
  -- pagar, que sí lo resta, se guarda aparte en fin_facturas.total.
  v_importe_total := v_base + v_cuota_iva;

  -- Una cadena de huellas por obligado tributario. El advisory lock serializa
  -- las expediciones de esa sociedad dentro de la transacción.
  perform pg_advisory_xact_lock(hashtext('fin_vf_' || v_f.sociedad_id::text));

  select orden, huella into v_orden, v_huella_ant
    from fin_verifactu_registros
   where sociedad_id = v_f.sociedad_id
   order by orden desc
   limit 1;

  v_orden := coalesce(v_orden, 0) + 1;   -- v_huella_ant queda null en el primero

  v_cadena := fin_vf_cadena_alta(
    v_nif_emisor, v_numero_completo, v_fecha_exp, v_f.tipo,
    v_cuota_iva, v_importe_total, v_huella_ant, v_ahora
  );
  v_huella := fin_vf_huella(v_cadena);
  v_qr := fin_vf_qr(v_nif_emisor, v_numero_completo, v_fecha_exp, v_importe_total);

  insert into fin_verifactu_registros (
    cuenta_id, sociedad_id, factura_id, tipo_registro, orden, huella,
    huella_anterior, fecha_hora_registro, payload
  ) values (
    v_f.cuenta_id, v_f.sociedad_id, v_f.id, 'alta', v_orden, v_huella,
    v_huella_ant, v_ahora,
    jsonb_build_object(
      'IDEmisorFactura',          v_nif_emisor,
      'NumSerieFactura',          v_numero_completo,
      'FechaExpedicionFactura',   fin_vf_fecha(v_fecha_exp),
      'TipoFactura',              v_f.tipo,
      'CuotaTotal',               fin_vf_importe(v_cuota_iva),
      'ImporteTotal',             fin_vf_importe(v_importe_total),
      'Huella',                   coalesce(v_huella_ant, ''),
      'FechaHoraHusoGenRegistro', fin_vf_fecha_hora(v_ahora),
      'cadena',                   v_cadena,
      'qr',                       v_qr
    )
  ) returning id into v_registro_id;

  insert into fin_verifactu_envios (cuenta_id, registro_id, estado)
  values (v_f.cuenta_id, v_registro_id, 'pendiente');

  -- Congelar la factura. El trigger fin_facturas_proteger deja pasar este
  -- UPDATE porque la fila todavía era borrador.
  update fin_facturas
     set numero            = v_numero,
         numero_completo   = v_numero_completo,
         fecha_expedicion  = v_ahora,
         base_total        = v_base,
         cuota_iva_total   = v_cuota_iva,
         cuota_retencion   = v_cuota_ret,
         total             = v_base + v_cuota_iva - v_cuota_ret,
         estado            = 'expedida',
         expedida_por      = auth.uid()
   where id = v_f.id;

  insert into fin_verifactu_eventos (cuenta_id, sociedad_id, tipo, detalle)
  values (v_f.cuenta_id, v_f.sociedad_id, 'expedicion',
          jsonb_build_object('factura_id', v_f.id, 'numero_completo', v_numero_completo,
                             'orden', v_orden, 'huella', v_huella, 'usuario', auth.uid()));

  return jsonb_build_object(
    'numero_completo', v_numero_completo,
    'huella',          v_huella,
    'huella_anterior', v_huella_ant,
    'orden',           v_orden,
    'qr',              v_qr,
    'total',           v_base + v_cuota_iva - v_cuota_ret,
    'importe_registro', v_importe_total
  );
end $$;

-- ----------------------------------------------------------------------------
-- 2) Anular — nunca se borra una factura expedida
-- ----------------------------------------------------------------------------

create or replace function fin_anular_factura(p_factura_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer
set search_path = public
set timezone = 'Europe/Madrid'
as $$
declare
  v_f           fin_facturas%rowtype;
  v_nif_emisor  text;
  v_ahora       timestamptz := now();
  v_orden       bigint;
  v_huella_ant  text;
  v_cadena      text;
  v_huella      text;
  v_registro_id uuid;
begin
  select * into v_f from fin_facturas where id = p_factura_id for update;
  if not found then
    raise exception 'La factura no existe';
  end if;

  if v_f.cuenta_id is distinct from cuenta_actual() and not es_operador() then
    raise exception 'Sin permiso sobre esta factura';
  end if;

  if v_f.estado <> 'expedida' then
    raise exception 'Solo se anula una factura expedida (esta está %)', v_f.estado;
  end if;

  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'La anulación necesita un motivo';
  end if;

  select cif into v_nif_emisor from sociedades where id = v_f.sociedad_id;

  perform pg_advisory_xact_lock(hashtext('fin_vf_' || v_f.sociedad_id::text));

  select orden, huella into v_orden, v_huella_ant
    from fin_verifactu_registros
   where sociedad_id = v_f.sociedad_id
   order by orden desc
   limit 1;

  v_orden := coalesce(v_orden, 0) + 1;

  v_cadena := fin_vf_cadena_anulacion(
    v_nif_emisor, v_f.numero_completo, v_f.fecha_expedicion::date, v_huella_ant, v_ahora
  );
  v_huella := fin_vf_huella(v_cadena);

  insert into fin_verifactu_registros (
    cuenta_id, sociedad_id, factura_id, tipo_registro, orden, huella,
    huella_anterior, fecha_hora_registro, payload
  ) values (
    v_f.cuenta_id, v_f.sociedad_id, v_f.id, 'anulacion', v_orden, v_huella,
    v_huella_ant, v_ahora,
    jsonb_build_object(
      'IDEmisorFacturaAnulada',        v_nif_emisor,
      'NumSerieFacturaAnulada',        v_f.numero_completo,
      'FechaExpedicionFacturaAnulada', fin_vf_fecha(v_f.fecha_expedicion::date),
      'Huella',                        coalesce(v_huella_ant, ''),
      'FechaHoraHusoGenRegistro',      fin_vf_fecha_hora(v_ahora),
      'cadena',                        v_cadena,
      'motivo',                        p_motivo
    )
  ) returning id into v_registro_id;

  insert into fin_verifactu_envios (cuenta_id, registro_id, estado)
  values (v_f.cuenta_id, v_registro_id, 'pendiente');

  -- 'estado' es de los campos que el trigger deja mutar tras expedir.
  update fin_facturas set estado = 'anulada' where id = v_f.id;

  insert into fin_verifactu_eventos (cuenta_id, sociedad_id, tipo, detalle)
  values (v_f.cuenta_id, v_f.sociedad_id, 'anulacion',
          jsonb_build_object('factura_id', v_f.id, 'numero_completo', v_f.numero_completo,
                             'orden', v_orden, 'huella', v_huella, 'motivo', p_motivo,
                             'usuario', auth.uid()));

  return jsonb_build_object(
    'numero_completo', v_f.numero_completo,
    'huella',          v_huella,
    'orden',           v_orden
  );
end $$;

-- ----------------------------------------------------------------------------
-- 3) Permisos: se invocan desde la app con la sesión del usuario
-- ----------------------------------------------------------------------------

revoke all on function fin_expedir_factura(uuid) from public;
revoke all on function fin_anular_factura(uuid, text) from public;
grant execute on function fin_expedir_factura(uuid) to authenticated;
grant execute on function fin_anular_factura(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Comprobación con los tres ejemplos oficiales de la AEAT
--    (documento de la huella v0.1.2, apartado 6). Debe devolver tres 'true'.
--    Se puede ejecutar tal cual después de aplicar la migración.
-- ----------------------------------------------------------------------------
--
-- select
--   fin_vf_huella('IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00')
--     = '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60' as caso_1_alta_primera,
--   fin_vf_huella('IDEmisorFactura=89890001K&NumSerieFactura=12345679/G34&FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60&FechaHoraHusoGenRegistro=2024-01-01T19:20:35+01:00')
--     = 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97' as caso_2_alta_encadenada,
--   fin_vf_huella('IDEmisorFacturaAnulada=89890001K&NumSerieFacturaAnulada=12345679/G34&FechaExpedicionFacturaAnulada=01-01-2024&Huella=F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97&FechaHoraHusoGenRegistro=2024-01-01T19:20:40+01:00')
--     = '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68' as caso_3_anulacion;
--
-- Y el ejemplo de «URL encoding» del documento del QR (numserie con '&'):
--
-- select fin_vf_url_encode('12345678&G33') = '12345678%26G33' as qr_encoding;
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- NOTA DE APLICACIÓN (16-08-2026)
-- Se aplicó con apply_migration y quedó registrada en la base con la versión
-- 20260816182802, distinta del nombre de este archivo. Para que el repo y el
-- remoto digan lo mismo, el archivo se renombró a esa versión: así un
-- `supabase db push` no la ve como pendiente ni intenta reaplicarla.
--
-- Al aplicarla se detectó que el `revoke ... from public` de abajo NO quita la
-- concesión que Supabase da por defecto a `anon`. Lo cierra la migración
-- 20260816190000_fin_f1b_permisos_expedir.sql.
-- ----------------------------------------------------------------------------
