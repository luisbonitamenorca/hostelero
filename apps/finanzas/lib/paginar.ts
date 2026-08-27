/**
 * Supabase corta cada petición a 1.000 filas (db-max-rows) SIN avisar. Toda
 * consulta que pueda superar ese tope debe pedirse por páginas — si no, los
 * mapas se quedan cojos y la pantalla miente (facturas «sin asiento» que sí
 * lo tienen: bug real del 28-08-2026).
 */
export async function paginar<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const todo: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data } = await consulta(desde, desde + 999);
    todo.push(...(data ?? []));
    if (!data || data.length < 1000) return todo;
  }
}
