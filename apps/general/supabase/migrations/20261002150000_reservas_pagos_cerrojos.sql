-- Reservas v2 · pagos: cerrojos en la base contra cobrar o devolver dos veces.
--
-- El código (lib/pagos-reservas.ts) comprobaba tras insertar qué operación se había creado
-- primero (orden por creado_en). creado_en es now() del INICIO de cada transacción, no el orden
-- real de confirmación: con dos inserts solapados los dos podían creerse los primeros y salir dos
-- cargos REST al banco. Estos índices únicos parciales hacen que el segundo INSERT falle (23505),
-- y el código lo traduce a «en_curso».

-- Un solo cargo de garantía vivo (en curso o cobrado) por reserva. Las anotaciones del cron sin
-- ds_order no cuentan (no han ido al banco).
create unique index if not exists reservas_pagos_un_cargo_vivo
  on public.reservas_pagos (reserva_id)
  where tipo = 'cargo_noshow' and estado in ('iniciado', 'cobrado') and ds_order is not null;

-- Una sola devolución en curso por cobro. Así, cuando una devolución consigue insertarse, las
-- anteriores de ese cobro ya están confirmadas (devuelto/fallido) y la suma «devuelto + en curso
-- ≤ cobrado» que hace el código después del insert es exacta.
create unique index if not exists reservas_pagos_una_devolucion_viva
  on public.reservas_pagos (pago_origen_id)
  where tipo = 'devolucion' and estado = 'iniciado';
