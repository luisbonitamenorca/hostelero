import { exigirModulo } from "@/lib/supabase/server";
import {
  calcularPeriodo,
  sumasYSaldos,
  type ApunteInforme,
  type ModoPeriodo,
} from "@/lib/contabilidad";

/**
 * Carga los apuntes que necesitan los tres informes y devuelve ya las filas de
 * saldos, que es de donde salen los tres.
 *
 * DOS DECISIONES QUE IMPORTAN:
 *
 * · Se piden los apuntes desde el 1 de enero, no desde `desde`. El balance es
 *   una foto a fecha: necesita TODO lo acumulado hasta el corte, no solo el
 *   movimiento del mes. Pedir solo el periodo daría un balance que cuadra por
 *   casualidad y con las cifras mal.
 *
 * · Solo entran los asientos CONFIRMADOS. Un borrador es una intención, no un
 *   hecho contable: si contara, el balance cambiaría mientras alguien teclea.
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

  // La consulta arranca en fin_asientos y NO en fin_apuntes, aunque lo que se
  // quiere sean los apuntes. Así los tres filtros (estado y las dos fechas)
  // son de primer nivel, que es el único caso que este código ya tiene probado
  // en producción — filtrar sobre una tabla incrustada es otra sintaxis y no
  // había ni un precedente en el módulo con el que contrastarla.
  const [{ data, error }, { data: centros }] = await Promise.all([
    supabase
      .from("fin_asientos")
      .select("fecha, fin_apuntes(debe, haber, centro_id, fin_plan_cuentas(codigo, nombre))")
      .eq("estado", "confirmado")
      .gte("fecha", inicioEjercicio)
      .lte("fecha", periodo.hasta)
      .limit(5000),
    supabase.from("centros").select("id, nombre").order("nombre"),
  ]);

  type AsientoCrudo = {
    fecha: string;
    fin_apuntes: {
      debe: number;
      haber: number;
      centro_id: string | null;
      fin_plan_cuentas: { codigo: string; nombre: string } | null;
    }[];
  };

  // El filtro por centro se aplica AQUÍ y no en la consulta porque el balance lo
  // necesita completo: filtrar un balance por centro no significa nada — la
  // tesorería o el capital no son de un centro —, y dejaría un descuadre falso.
  // Solo la PyG lo usa.
  const centroPedido = sp.centro || null;

  const todos: (ApunteInforme & { centroId: string | null })[] = (
    (data ?? []) as unknown as AsientoCrudo[]
  ).flatMap((a) =>
    (a.fin_apuntes ?? [])
      .filter((ap) => ap.fin_plan_cuentas)
      .map((ap) => ({
        codigo: ap.fin_plan_cuentas!.codigo,
        nombre: ap.fin_plan_cuentas!.nombre,
        fecha: a.fecha,
        debe: Number(ap.debe),
        haber: Number(ap.haber),
        centroId: ap.centro_id,
      })),
  );

  const apuntes: ApunteInforme[] = todos;
  const apuntesDelCentro: ApunteInforme[] = centroPedido
    ? todos.filter((a) => a.centroId === centroPedido)
    : todos;

  // El periodo puede empezar después del 1 de enero: sumasYSaldos separa lo
  // anterior de lo del tramo pedido usando esa misma fecha.
  const filas = sumasYSaldos(apuntes, periodo.desde, periodo.hasta);
  const filasDelCentro =
    apuntesDelCentro === apuntes
      ? filas
      : sumasYSaldos(apuntesDelCentro, periodo.desde, periodo.hasta);

  return {
    anio,
    modo,
    periodo,
    filas,
    /** Igual que `filas` si no se ha pedido centro. Lo usa solo la PyG. */
    filasDelCentro,
    centros: (centros ?? []) as { id: string; nombre: string }[],
    centroPedido,
    error,
    hayApuntes: apuntes.length > 0,
  };
}
