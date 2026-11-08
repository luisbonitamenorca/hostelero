-- Reparto de nóminas (Ratios · Salarios): departamento al repartir.
-- 08-11-2026. Cuando el coste de un trabajador se reparte a otros centros,
-- la fila conserva el departamento de la gestoría (p. ej. OFICINA → sale como
-- Estructura dentro de Binifadet). Con esta columna el reparto puede fijar el
-- departamento en que cae el coste repartido. NULL = el de la gestoría.
alter table public.nominas_reparto       add column if not exists departamento text;
alter table public.nominas_reparto_horas add column if not exists departamento text;

-- Decisión de Luis (08-11-2026): Daniel Poleo va siempre a Cocina.
update public.nominas_reparto set departamento = 'COCINA'
 where nombre = 'POLEO GARCIA DANIEL' and departamento is null;
