-- La secuencia de códigos de producto quedó por detrás de los códigos migrados
-- (iba por 360 con productos hasta P-01437): cada alta chocaba con un código
-- ocupado y el 409 tiraba el documento entero. Se sincroniza y, además, el
-- generador salta él solo cualquier código que ya exista: nunca más un choque.
select setval('compras_producto_seq',
  greatest((select last_value from compras_producto_seq),
           coalesce((select max(substring(codigo_interno from 'P-(\d+)')::int)
                       from compras_producto where codigo_interno ~ '^P-\d+$'), 0)));

create or replace function public.compras_next_codigo()
returns text
language plpgsql
as $$
declare
  v text;
begin
  loop
    v := 'P-' || lpad(nextval('compras_producto_seq')::text, 5, '0');
    exit when not exists (select 1 from compras_producto where codigo_interno = v);
  end loop;
  return v;
end $$;
