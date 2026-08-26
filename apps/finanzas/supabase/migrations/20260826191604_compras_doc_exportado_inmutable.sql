-- Incidente 25/26-08-2026: facturas duplicadas de la semana de la migración;
-- el exportador numeró una copia (2360-2378), alguien borró justo las copias
-- numeradas en una limpieza de duplicados, y al día siguiente las
-- supervivientes se renumeraron (2381+). Resultado: los listados de Lucía
-- saltan números y las mismas facturas aparecen con dos números distintos.
--
-- Regla nueva, misma filosofía que los asientos confirmados de Finanzas: un
-- documento ya EXPORTADO A A3 es inmutable en su existencia — no se borra,
-- se corrige en A3 o se anula con un abono. El duplicado que haya que
-- limpiar será siempre la copia SIN numerar.
create or replace function compras_doc_proteger_exportado()
returns trigger
language plpgsql
as $$
begin
  if old.a3_numdoc is not null then
    raise exception 'La factura % ya está exportada a A3 con el número %: no se borra, se corrige en A3 o se anula con un abono',
      coalesce(old.num_documento, old.id::text), old.a3_numdoc;
  end if;
  return old;
end $$;

create trigger trg_compras_doc_proteger_exportado
  before delete on compras_doc
  for each row execute function compras_doc_proteger_exportado();
