-- Facturación se fusiona en contabilidad (pedido de Luis, 25-08-2026): la app
-- de Finanzas es una sola y tener dos módulos contratables para lo mismo solo
-- generaba dobles casillas en la rejilla de vetos y en la consola. El código
-- ya exige `contabilidad` en todas las pantallas que antes pedían
-- `facturacion`. El único veto que existía (Vanesa, Tamarindos) también tenía
-- vetada contabilidad, así que nadie gana ni pierde acceso con esta baja.
delete from modulos_vetados where modulo_id = 'facturacion';
delete from modulos_contratados where modulo_id = 'facturacion';
delete from modulos where id = 'facturacion';
