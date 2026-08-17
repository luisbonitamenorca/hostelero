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

/**
 * Trae TODOS los apuntes confirmados del ejercicio hasta `hasta`, paginando de
 * 500 asientos en 500. Sin paginar, el día que el diario tenga miles de
 * asientos la consulta devolvería una página silenciosamente incompleta y los
 * informes CUADRARÍAN con cifras falsas, que es el peor fallo posible aquí.
 */
async function traerApuntes(
  supabase: Awaited<ReturnType<typeof exigirModulo>>["supabase"],
  inicioEjercicio: string,
  hasta: string,
): Promise<{ apuntes: ApunteConCentro[]; error: { message: string } | null }> {
  const PASO = 500;
  const apuntes: ApunteConCentro[] = [];

  for (let desde = 0; ; desde += PASO) {
    const { data, error } = await supabase
      .from("fin_asientos")
      .select("fecha, fin_apuntes(debe, haber, centro_id, fin_plan_cuentas(codigo, nombre))")
      .eq("estado", "confirmado")
      .gte("fecha", inicioEjercicio)
      .lte("fecha", hasta)
      .order("fecha")
      .order("id")
      .range(desde, desde + PASO - 1);

    if (error) return { apuntes, error };

    const pagina = (data ?? []) as unknown as AsientoCrudo[];
    for (const a of pagina) {
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
    if (pagina.length < PASO) break;
  }

  return { apuntes, error: null };
}

/**
 * Base común de los informes en columnas (balance y PyG): apuntes completos
 * del ejercicio + los tramos de la vista pedida.
 *
 * DOS DECISIONES QUE IMPORTAN:
 *
 * · Se piden los apuntes desde el 1 de enero SIEMPRE. El balance es una foto
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
    traerApuntes(supabase, inicioEjercicio, hasta),
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

  const inicioEjercicio = `${anio}-01-01`;
  const { apuntes, error } = await traerApuntes(supabase, inicioEjercicio, periodo.hasta);

  const filas = sumasYSaldos(apuntes, periodo.desde, periodo.hasta);

  return { anio, modo, periodo, filas, error, hayApuntes: apuntes.length > 0 };
}
