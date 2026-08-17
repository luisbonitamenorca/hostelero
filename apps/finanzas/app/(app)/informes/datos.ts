import { exigirModulo } from "@/lib/supabase/server";
import {
  calcularPeriodo,
  sumasYSaldos,
  tramosDeVista,
  type ApunteInforme,
  type ModoPeriodo,
  type Tramo,
  type Vista,
} from "@/lib/contabilidad";

type Cliente = Awaited<ReturnType<typeof exigirModulo>>["supabase"];

type AsientoCrudo = {
  fecha: string;
  fin_apuntes: {
    debe: number;
    haber: number;
    centro_id: string | null;
    fin_plan_cuentas: { codigo: string; nombre: string } | null;
  }[];
};

type ApunteConCentro = ApunteInforme & { centroId: string | null };
type Fuente = { apuntes: ApunteConCentro[]; error: { message: string } | null };

const esPrimerDia = (iso: string) => iso.endsWith("-01");

function esFinDeMes(iso: string): boolean {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCDate() === 1;
}

// ---------------------------------------------------------------- camino rápido

type FilaMensual = {
  codigo: string;
  nombre: string;
  fecha: string;
  centro_id: string | null;
  debe: number;
  haber: number;
};

/**
 * Camino RÁPIDO: fin_informe_mensual agrega en la base por (cuenta, mes,
 * centro) — unas 3.000 filas en vez de 21.000 apuntes — y con RLS del que
 * llama (security invoker). Solo vale cuando el periodo cae en meses enteros,
 * que es todo salvo «entre dos fechas».
 *
 * Devuelve null si la función aún no existe en la base (la migración F5c no
 * está aplicada): el que llama cae al camino lento con el detalle.
 */
async function traerMensual(supabase: Cliente, anio: number): Promise<Fuente | null> {
  const PASO = 1000;
  const apuntes: ApunteConCentro[] = [];

  // El cliente tipado no conoce la función hasta regenerar packages/db/types;
  // este molde local dice solo lo que se usa.
  const rpc = supabase as unknown as {
    rpc: (
      fn: "fin_informe_mensual",
      args: { p_anio: number },
    ) => {
      range: (
        a: number,
        b: number,
      ) => PromiseLike<{ data: FilaMensual[] | null; error: { message: string } | null }>;
    };
  };

  for (let desde = 0; ; desde += PASO) {
    const { data, error } = await rpc
      .rpc("fin_informe_mensual", { p_anio: anio })
      .range(desde, desde + PASO - 1);
    if (error) return null;

    const pagina = data ?? [];
    for (const f of pagina) {
      apuntes.push({
        codigo: f.codigo,
        nombre: f.nombre,
        fecha: f.fecha,
        debe: Number(f.debe),
        haber: Number(f.haber),
        centroId: f.centro_id,
      });
    }
    if (pagina.length < PASO) break;
  }

  return { apuntes, error: null };
}

// ---------------------------------------------------------------- camino lento

/**
 * Camino LENTO: el detalle apunte a apunte, paginado de 500 asientos en 500.
 * Sin paginar, con miles de asientos la consulta devolvería una página
 * silenciosamente incompleta y los informes CUADRARÍAN con cifras falsas, que
 * es el peor fallo posible aquí.
 *
 * Como mucho TRES páginas a la vez: en serie no daba tiempo a la función de
 * Vercel, y todas a la vez se pisaban entre ellas y saltaba el límite de
 * tiempo por consulta de la base (los informes no cargaban ni de una forma ni
 * de la otra).
 */
async function traerDetalle(
  supabase: Cliente,
  inicioEjercicio: string,
  hasta: string,
): Promise<Fuente> {
  const PASO = 500;
  const LOTE = 3;

  const { count, error: errorCuenta } = await supabase
    .from("fin_asientos")
    .select("id", { count: "exact", head: true })
    .eq("estado", "confirmado")
    .gte("fecha", inicioEjercicio)
    .lte("fecha", hasta);
  if (errorCuenta) return { apuntes: [], error: errorCuenta };

  const paginas = Math.max(1, Math.ceil((count ?? 0) / PASO));
  const apuntes: ApunteConCentro[] = [];

  for (let lote = 0; lote < paginas; lote += LOTE) {
    const resultados = await Promise.all(
      Array.from({ length: Math.min(LOTE, paginas - lote) }, (_, j) =>
        supabase
          .from("fin_asientos")
          .select("fecha, fin_apuntes(debe, haber, centro_id, fin_plan_cuentas(codigo, nombre))")
          .eq("estado", "confirmado")
          .gte("fecha", inicioEjercicio)
          .lte("fecha", hasta)
          .order("fecha")
          .order("id")
          .range((lote + j) * PASO, (lote + j) * PASO + PASO - 1),
      ),
    );

    for (const { data, error } of resultados) {
      if (error) return { apuntes: [], error };
      for (const a of (data ?? []) as unknown as AsientoCrudo[]) {
        for (const ap of a.fin_apuntes ?? []) {
          if (!ap.fin_plan_cuentas) continue;
          apuntes.push({
            codigo: ap.fin_plan_cuentas.codigo,
            nombre: ap.fin_plan_cuentas.nombre,
            fecha: a.fecha,
            debe: Number(ap.debe),
            haber: Number(ap.haber),
            centroId: ap.centro_id,
          });
        }
      }
    }
  }

  return { apuntes, error: null };
}

async function traerApuntes(
  supabase: Cliente,
  anio: number,
  desde: string,
  hasta: string,
): Promise<Fuente> {
  if (esPrimerDia(desde) && esFinDeMes(hasta)) {
    const rapido = await traerMensual(supabase, anio);
    if (rapido) return rapido;
  }
  return traerDetalle(supabase, `${anio}-01-01`, hasta);
}

// ---------------------------------------------------------------- cargas

/**
 * Base común de los informes en columnas (balance y PyG): apuntes completos
 * del ejercicio + los tramos de la vista pedida.
 *
 * DOS DECISIONES QUE IMPORTAN:
 *
 * · Se piden los datos desde el 1 de enero SIEMPRE. El balance es una foto
 *   acumulada y la PyG por columnas necesita el año entero de todas formas.
 *
 * · Solo entran los asientos CONFIRMADOS. Un borrador es una intención, no un
 *   hecho contable: si contara, el balance cambiaría mientras alguien teclea.
 */
export async function cargarApuntes(sp: Record<string, string | undefined>) {
  const { supabase } = await exigirModulo("contabilidad");

  const anio = Number(sp.anio) || new Date().getFullYear();
  const vista = (["anual", "trimestres", "meses", "rango"].includes(sp.vista ?? "")
    ? sp.vista
    : "anual") as Vista;
  const tramos: Tramo[] = tramosDeVista(anio, vista, { desde: sp.desde, hasta: sp.hasta });

  const inicioEjercicio = `${anio}-01-01`;
  const hasta = tramos[tramos.length - 1].hasta;

  const [{ apuntes: todos, error }, { data: centros }] = await Promise.all([
    traerApuntes(supabase, anio, tramos[0].desde, hasta),
    supabase.from("centros").select("id, nombre").order("nombre"),
  ]);

  // El filtro por centro se aplica AQUÍ y no en la consulta porque el balance lo
  // necesita completo: filtrar un balance por centro no significa nada — la
  // tesorería o el capital no son de un centro. Solo la PyG lo usa.
  const centroPedido = sp.centro || null;
  const apuntes: ApunteInforme[] = todos;
  const apuntesDelCentro: ApunteInforme[] = centroPedido
    ? todos.filter((a) => a.centroId === centroPedido)
    : todos;

  return {
    anio,
    vista,
    tramos,
    inicioEjercicio,
    apuntes,
    apuntesDelCentro,
    centros: (centros ?? []) as { id: string; nombre: string }[],
    centroPedido,
    error,
    hayApuntes: todos.length > 0,
  };
}

/**
 * Sumas y saldos sigue siendo de UN tramo (apertura / movimiento / cierre por
 * cuenta): en columnas por mes serían 36 columnas de debe y haber y no se
 * leería. Conserva el selector clásico de periodo.
 */
export async function cargarSaldos(sp: Record<string, string | undefined>) {
  const { supabase } = await exigirModulo("contabilidad");

  const anio = Number(sp.anio) || new Date().getFullYear();
  const modo = (sp.modo as ModoPeriodo) || "anual";
  const periodo = calcularPeriodo(anio, modo, {
    mes: sp.mes ? Number(sp.mes) : undefined,
    trimestre: sp.trimestre ? Number(sp.trimestre) : undefined,
    desde: sp.desde,
    hasta: sp.hasta,
  });

  const { apuntes, error } = await traerApuntes(supabase, anio, periodo.desde, periodo.hasta);

  const filas = sumasYSaldos(apuntes, periodo.desde, periodo.hasta);

  return { anio, modo, periodo, filas, error, hayApuntes: apuntes.length > 0 };
}
