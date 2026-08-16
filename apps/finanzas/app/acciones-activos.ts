"use server";

import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/supabase/server";
import { clienteActivos } from "@/lib/activos";
import { calcularCuadro } from "@/lib/amortizacion";

/**
 * Da de alta un activo y deja calculado su cuadro de amortización completo.
 * Se guarda entero en vez de calcularse al vuelo porque, una vez contabilizado
 * un periodo, su importe es historia: si mañana cambia la vida útil, lo ya
 * cerrado no se recalcula.
 */
export async function crearActivo(datos: {
  nombre: string;
  descripcion: string | null;
  centroId: string | null;
  cuentaActivoId: string;
  cuentaAmortizacionId: string | null;
  cuentaDotacionId: string | null;
  fechaAlta: string;
  valorAdquisicion: number;
  valorResidual: number;
  aniosVidaUtil: number;
  proveedor: string | null;
}) {
  const { supabase, cuenta } = await exigirModulo("contabilidad");
  const db = clienteActivos(supabase);

  if (!datos.nombre.trim()) return { error: "Ponle un nombre al activo." };
  if (!datos.cuentaActivoId) return { error: "Elige la cuenta contable del activo." };
  if (!datos.fechaAlta) return { error: "Falta la fecha de puesta en servicio: desde ahí se amortiza." };
  if (!(datos.valorAdquisicion > 0)) return { error: "El valor de adquisición tiene que ser mayor que cero." };
  if (datos.valorResidual > datos.valorAdquisicion) {
    return { error: "El valor residual no puede superar al de adquisición." };
  }
  if (!(datos.aniosVidaUtil > 0)) return { error: "Los años de vida útil tienen que ser mayores que cero." };

  const { data: sociedad } = await supabase
    .from("sociedades").select("id").eq("cuenta_id", cuenta.id).limit(1).maybeSingle();
  if (!sociedad) return { error: "No hay sociedad en la cuenta." };

  const { data: activo, error } = await db
    .from("fin_activos")
    .insert({
      cuenta_id: cuenta.id,
      sociedad_id: sociedad.id,
      nombre: datos.nombre.trim(),
      descripcion: datos.descripcion?.trim() || null,
      centro_id: datos.centroId || null,
      cuenta_activo_id: datos.cuentaActivoId,
      cuenta_amortizacion_id: datos.cuentaAmortizacionId || null,
      cuenta_dotacion_id: datos.cuentaDotacionId || null,
      fecha_alta: datos.fechaAlta,
      valor_adquisicion: datos.valorAdquisicion,
      valor_residual: datos.valorResidual,
      anios_vida_util: datos.aniosVidaUtil,
      proveedor: datos.proveedor?.trim() || null,
    })
    .select("id")
    .single();

  if (error || !activo) return { error: `No se pudo crear el activo: ${error?.message}` };

  const cuadro = calcularCuadro({
    fechaAlta: datos.fechaAlta,
    valorAdquisicion: datos.valorAdquisicion,
    valorResidual: datos.valorResidual,
    aniosVidaUtil: datos.aniosVidaUtil,
  });

  if (cuadro.length > 0) {
    const { error: errorCuadro } = await db.from("fin_amortizaciones").insert(
      cuadro.map((f) => ({
        cuenta_id: cuenta.id,
        activo_id: activo.id,
        ejercicio: f.ejercicio,
        periodo: f.periodo,
        importe: f.importe,
        acumulado: f.acumulado,
      })),
    );
    if (errorCuadro) {
      return { error: `El activo se creó pero su cuadro no: ${errorCuadro.message}` };
    }
  }

  revalidatePath("/activos");
  return { ok: true, id: activo.id, periodos: cuadro.length };
}

/** Baja del activo. No se borra: se marca, y se conserva lo amortizado. */
export async function darDeBajaActivo(id: string, fechaBaja: string, motivo: string, valorBaja: number | null) {
  const { supabase } = await exigirModulo("contabilidad");

  if (!fechaBaja) return { error: "Falta la fecha de baja." };
  if (!motivo.trim()) return { error: "Di por qué se da de baja: venta, rotura, obsolescencia…" };

  const { error } = await clienteActivos(supabase)
    .from("fin_activos")
    .update({ estado: "baja", fecha_baja: fechaBaja, motivo_baja: motivo.trim(), valor_baja: valorBaja })
    .eq("id", id);

  if (error) return { error: `No se pudo dar de baja: ${error.message}` };

  revalidatePath("/activos");
  revalidatePath(`/activos/${id}`);
  return { ok: true };
}
