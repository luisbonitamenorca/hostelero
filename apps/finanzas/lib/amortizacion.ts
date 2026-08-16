import { redondear } from "./importes.ts";

/**
 * Cuadro de amortización lineal, por meses y prorrateado por días.
 *
 * Decisiones que van dentro, porque no son obvias:
 *
 *  · Se amortiza la BASE, que es el valor de adquisición menos el residual. Lo
 *    que se espera recuperar al final no es gasto.
 *  · El primer mes se prorratea por días desde la puesta en servicio: un horno
 *    instalado el 20 de marzo no amortiza el mes de marzo entero.
 *  · El ÚLTIMO periodo se ajusta para que el acumulado cuadre exactamente con
 *    la base. Sin ese ajuste, 120 redondeos mensuales dejan unos céntimos sin
 *    amortizar y el activo nunca llega a cero.
 */

export type Activo = {
  fechaAlta: string;          // AAAA-MM-DD, puesta en servicio
  valorAdquisicion: number;
  valorResidual: number;
  aniosVidaUtil: number;
};

export type PeriodoAmortizacion = {
  ejercicio: number;
  periodo: number;            // 1 a 12
  importe: number;
  acumulado: number;
  pendiente: number;
};

function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

export function calcularCuadro(a: Activo): PeriodoAmortizacion[] {
  const base = redondear(a.valorAdquisicion - a.valorResidual);
  if (base <= 0 || a.aniosVidaUtil <= 0) return [];

  const alta = new Date(a.fechaAlta + "T00:00:00");
  const anioInicio = alta.getFullYear();
  const mesInicio = alta.getMonth() + 1;
  const diaInicio = alta.getDate();

  const cuotaAnual = base / a.aniosVidaUtil;
  const cuotaMensual = cuotaAnual / 12;
  const mesesTotales = Math.ceil(a.aniosVidaUtil * 12);

  const filas: PeriodoAmortizacion[] = [];
  let acumulado = 0;
  let anio = anioInicio;
  let mes = mesInicio;

  for (let i = 0; i < mesesTotales + 1; i++) {
    let importe: number;

    if (i === 0) {
      // Prorrateo del primer mes: solo los días desde la puesta en servicio.
      const dias = diasDelMes(anio, mes);
      const diasAmortizables = dias - diaInicio + 1;
      importe = redondear((cuotaMensual * diasAmortizables) / dias);
    } else {
      importe = redondear(cuotaMensual);
    }

    // No pasarse de la base: el último periodo se lleva lo que quede.
    const pendienteAntes = redondear(base - acumulado);
    if (importe >= pendienteAntes || i === mesesTotales) {
      importe = pendienteAntes;
    }

    if (importe > 0) {
      acumulado = redondear(acumulado + importe);
      filas.push({
        ejercicio: anio,
        periodo: mes,
        importe,
        acumulado,
        pendiente: redondear(base - acumulado),
      });
    }

    if (acumulado >= base) break;

    mes += 1;
    if (mes > 12) {
      mes = 1;
      anio += 1;
    }
  }

  return filas;
}

/** Lo amortizado hasta una fecha, para el valor contable actual. */
export function amortizadoHasta(cuadro: PeriodoAmortizacion[], hasta: Date = new Date()): number {
  const anio = hasta.getFullYear();
  const mes = hasta.getMonth() + 1;
  const pasados = cuadro.filter((f) => f.ejercicio < anio || (f.ejercicio === anio && f.periodo <= mes));
  return pasados.length > 0 ? pasados[pasados.length - 1].acumulado : 0;
}

/** Cuenta de amortización acumulada y de dotación que corresponden al activo.
 *  En el PGC se forman metiendo un 8 detrás del 2: 213 → 2813 → 681. */
export function cuentasSugeridas(codigoActivo: string): { acumulada: string; dotacion: string } | null {
  const c = codigoActivo.trim();
  if (!/^2\d{2,}$/.test(c)) return null;

  const grupo = c[1]; // 0 intangible, 1 material
  if (grupo === "0") return { acumulada: "280" + c.slice(2), dotacion: "680" };
  if (grupo === "1") return { acumulada: "281" + c.slice(2), dotacion: "681" };
  return null;
}
