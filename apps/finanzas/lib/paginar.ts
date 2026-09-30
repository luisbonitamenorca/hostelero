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

/**
 * Como paginar(), pero sin esperar página a página: la primera trae además el
 * total (count exacto) y las demás se lanzan a la vez, de `simultaneas` en
 * `simultaneas` para no tumbar la base con consultas pesadas (una RPC se
 * vuelve a calcular entera en cada página). Si la base no da total, sigue en
 * serie como paginar().
 *
 * `consulta(desde, hasta, contar)`: con contar = true hay que pedir
 * { count: "exact" }; en el resto de páginas, no (contar cuesta).
 * Devuelve el error de la primera página que falle, para que el que llama
 * decida (los informes, por ejemplo, caen a otro camino).
 */
export async function paginarEnParalelo<T>(
  consulta: (
    desde: number,
    hasta: number,
    contar: boolean,
  ) => PromiseLike<{ data: T[] | null; count?: number | null; error?: { message: string } | null }>,
  simultaneas = 3,
): Promise<{ filas: T[]; error: { message: string } | null }> {
  const PASO = 1000;
  const primera = await consulta(0, PASO - 1, true);
  if (primera.error) return { filas: [], error: primera.error };
  const filas: T[] = [...(primera.data ?? [])];
  if (filas.length < PASO) return { filas, error: null };

  const total = primera.count;
  if (total == null) {
    // Sin total: en serie hasta que una página venga corta.
    for (let desde = PASO; ; desde += PASO) {
      const r = await consulta(desde, desde + PASO - 1, false);
      if (r.error) return { filas: [], error: r.error };
      filas.push(...(r.data ?? []));
      if (!r.data || r.data.length < PASO) return { filas, error: null };
    }
  }

  const inicios: number[] = [];
  for (let desde = PASO; desde < total; desde += PASO) inicios.push(desde);
  for (let i = 0; i < inicios.length; i += simultaneas) {
    const resultados = await Promise.all(
      inicios.slice(i, i + simultaneas).map((d) => consulta(d, d + PASO - 1, false)),
    );
    // Promise.all conserva el orden: las filas quedan en el de la consulta.
    for (const r of resultados) {
      if (r.error) return { filas: [], error: r.error };
      filas.push(...(r.data ?? []));
    }
  }
  return { filas, error: null };
}

/**
 * Parte una lista en trozos. Para los .in("id", [...]) con miles de uuid: en
 * una sola petición la URL crece sin freno y PostgREST la rechaza (o el
 * proxy), así que se piden en lotes y en paralelo.
 */
export function trocear<T>(lista: T[], tam = 200): T[][] {
  const trozos: T[][] = [];
  for (let i = 0; i < lista.length; i += tam) trozos.push(lista.slice(i, i + tam));
  return trozos;
}

/**
 * Un .in() con miles de ids, troceado en lotes de `tam` que salen a la vez.
 * Quita duplicados antes (la misma factura puede tener varios vencimientos).
 * Cada lote cabe de sobra por debajo de las 1.000 filas si se piden por id.
 */
export async function pedirEnLotes<T>(
  ids: string[],
  pedir: (lote: string[]) => PromiseLike<{ data: T[] | null }>,
  tam = 200,
): Promise<T[]> {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return [];
  const resultados = await Promise.all(trocear(unicos, tam).map(pedir));
  return resultados.flatMap((r) => r.data ?? []);
}
