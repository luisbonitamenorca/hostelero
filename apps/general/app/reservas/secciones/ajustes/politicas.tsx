"use client";

/* Ajustes › Políticas y pagos: qué se exige al cliente (nada, tarjeta como garantía, prepago),
   desde cuántas personas, importes, horas de la política de cancelación, no-show automático y
   cobro. Incluye el estado del TPV (si hay comercio configurado en el servidor). */

import { useEffect, useMemo, useState } from "react";
import type { Restaurante } from "../../tipos";
import { estadoProveedores, guardarRestauranteAjustes, type CamposRestaurante } from "../../acciones/ajustes";
import { Cabecera, Campo, Chip, Interruptor, Panel, PieGuardar, SoloLectura, fmtEuros, useAccion, useSucio, type AjProps } from "./comunes";

type Modo = "gratis" | "politica" | "prepago";

type Form = {
  modo: Modo;
  tarjeta_desde_pax: string;
  garantia_importe_pax: string;
  prepago_importe_pax: string;
  politica_cancelacion_horas: string;
  tarjeta_caduca_min: string;
  noshow_automatico: boolean;
  cobro_noshow_automatico: boolean;
  envio_noshow: boolean;
};

function formDe(r: Restaurante): Form {
  const modo: Modo = r.prepago_importe_pax != null && r.prepago_importe_pax > 0 ? "prepago" : r.tarjeta_desde_pax != null ? "politica" : "gratis";
  return {
    modo,
    tarjeta_desde_pax: r.tarjeta_desde_pax != null ? String(r.tarjeta_desde_pax) : "1",
    garantia_importe_pax: r.garantia_importe_pax != null ? String(r.garantia_importe_pax) : "",
    prepago_importe_pax: r.prepago_importe_pax != null ? String(r.prepago_importe_pax) : "",
    politica_cancelacion_horas: String(r.politica_cancelacion_horas ?? 24),
    tarjeta_caduca_min: String(r.tarjeta_caduca_min ?? 30),
    noshow_automatico: r.noshow_automatico,
    cobro_noshow_automatico: r.cobro_noshow_automatico,
    envio_noshow: r.envio_noshow,
  };
}

export default function AjPoliticas({ rest, avisar, puedeEditar, onRestaurante, onSucio }: AjProps) {
  const [f, setF] = useState<Form>(() => formDe(rest));
  const [base, setBase] = useState(() => JSON.stringify(formDe(rest)));
  const [prov, setProv] = useState<{ tpv: boolean; email: boolean; sms: boolean; whatsapp: boolean } | null>(null);
  const { ocupado, correr } = useAccion(avisar);
  const ro = !puedeEditar;

  useEffect(() => { estadoProveedores().then(setProv); }, []);
  useEffect(() => {
    const nuevo = formDe(rest);
    setF((actual) => (JSON.stringify(actual) === base ? nuevo : actual));
    setBase(JSON.stringify(nuevo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest]);

  const cambios = useMemo(() => JSON.stringify(f) !== base, [f, base]);
  useSucio(onSucio, cambios && !ro);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (s: string) => (s === "" ? null : parseFloat(s.replace(",", ".")));

  async function guardar() {
    const c: CamposRestaurante = {
      politica_cancelacion_horas: parseInt(f.politica_cancelacion_horas) || 0,
      tarjeta_caduca_min: parseInt(f.tarjeta_caduca_min) || 30,
      noshow_automatico: f.noshow_automatico,
      cobro_noshow_automatico: f.modo === "politica" ? f.cobro_noshow_automatico : false,
      envio_noshow: f.envio_noshow,
    };
    if (f.modo === "gratis") {
      c.tarjeta_desde_pax = null;
      c.garantia_importe_pax = null;
      c.prepago_importe_pax = null;
    } else if (f.modo === "politica") {
      const desde = parseInt(f.tarjeta_desde_pax) || 1;
      const imp = num(f.garantia_importe_pax);
      if (!imp || imp <= 0) { avisar("Indica el importe por persona que se cobrará si no vienen."); return; }
      c.tarjeta_desde_pax = desde;
      c.garantia_importe_pax = imp;
      c.prepago_importe_pax = null;
    } else {
      // El prepago se aplica a todas las reservas online (reservas_disponibilidad_v2 y
      // reservas_crear_online_v2 no miran tarjeta_desde_pax en este modo): no se guarda umbral.
      const imp = num(f.prepago_importe_pax);
      if (!imp || imp <= 0) { avisar("Indica el importe por persona del prepago."); return; }
      c.tarjeta_desde_pax = null;
      c.prepago_importe_pax = imp;
      c.garantia_importe_pax = null;
    }
    const r = await correr(guardarRestauranteAjustes(rest.id, c), "Políticas guardadas.");
    if (r.ok && r.data) onRestaurante(r.data);
  }

  const desde = parseInt(f.tarjeta_desde_pax) || 1;
  const ejemploPax = Math.max(desde, 4);
  const resumen = useMemo(() => {
    if (f.modo === "gratis") return "Todas las reservas entran sin tarjeta. El no-show solo se registra.";
    if (f.modo === "politica") {
      const imp = num(f.garantia_importe_pax) ?? 0;
      return `A partir de ${desde} ${desde === 1 ? "persona" : "personas"} se pide la tarjeta (no se cobra nada). Si no vienen o cancelan con menos de ${f.politica_cancelacion_horas || 0} h, se cobran ${fmtEuros(imp)} por persona: una mesa de ${ejemploPax} pagaría ${fmtEuros(imp * ejemploPax)}.`;
    }
    const imp = num(f.prepago_importe_pax) ?? 0;
    return `Todas las reservas online pagan ${fmtEuros(imp)} por persona al reservar (una mesa de 4: ${fmtEuros(imp * 4)}), que se descuentan de la cuenta. Se devuelve si cancelan con más de ${f.politica_cancelacion_horas || 0} h.`;
  }, [f, desde, ejemploPax]);

  return (
    <>
      <Cabecera titulo="Políticas y pagos" texto="Qué se le exige al cliente al reservar y qué pasa si no viene. Los importes se leen siempre de aquí; el pago va por Redsys (redirección o cargo por referencia) y nunca pasa por nuestro servidor." />
      {ro ? <SoloLectura /> : null}

      <Panel titulo="Estado del TPV y los envíos">
        <div className="aj-chips">
          <Chip color={prov?.tpv ? "#2E9E5B" : "#8A9199"}>TPV Redsys: {prov == null ? "…" : prov.tpv ? "configurado" : "sin configurar"}</Chip>
          <Chip color={prov?.email ? "#2E9E5B" : "#8A9199"}>Email: {prov == null ? "…" : prov.email ? "activo" : "sin proveedor"}</Chip>
          <Chip color={prov?.sms ? "#2E9E5B" : "#8A9199"}>SMS: {prov == null ? "…" : prov.sms ? "activo" : "sin proveedor"}</Chip>
          <Chip color={prov?.whatsapp ? "#2E9E5B" : "#8A9199"}>WhatsApp: {prov == null ? "…" : prov.whatsapp ? "activo" : "sin proveedor"}</Chip>
        </div>
        {prov && !prov.tpv ? <div className="aj-aviso" style={{ marginTop: 10, marginBottom: 0 }}>Sin TPV configurado en el servidor, las reservas con tarjeta o prepago quedan en «tarjeta pendiente» y el cliente no puede completar el paso de pago. Las claves van en las variables de entorno (nunca aquí).</div> : null}
      </Panel>

      <Panel titulo="Tipo de reserva por defecto" texto="Lo que se aplica a las reservas online y a las nuevas del panel (en cada reserva se puede cambiar).">
        <div className="aj-interruptores" style={{ marginBottom: 12 }}>
          {([
            ["gratis", "Reserva gratis", "Sin tarjeta ni pago."],
            ["politica", "Con política de cancelación", "Tarjeta como garantía; cargo por persona si no vienen o cancelan tarde."],
            ["prepago", "Prepago", "Todas las reservas online pagan un importe por persona al reservar; se descuenta de la cuenta."],
          ] as [Modo, string, string][]).map(([id, t, d]) => (
            <label key={id} className="aj-item" style={{ cursor: ro ? "default" : "pointer", minHeight: 48, padding: "8px 12px", borderColor: f.modo === id ? "var(--aj-mar)" : undefined }}>
              <input type="radio" name="modo" checked={f.modo === id} disabled={ro} onChange={() => set("modo", id)} style={{ width: 18, minHeight: 0, margin: 0 }} />
              <div className="cuerpo"><div className="tit" style={{ fontSize: 13.5 }}>{t}</div><div className="det">{d}</div></div>
            </label>
          ))}
        </div>
        {f.modo !== "gratis" ? (
          <div className="aj-form estrecho">
            {f.modo === "politica" ? (
              <Campo label="Desde cuántas personas" ayuda="Por debajo, la reserva es gratis."><input type="number" min={1} max={500} value={f.tarjeta_desde_pax} disabled={ro} onChange={(e) => set("tarjeta_desde_pax", e.target.value)} /></Campo>
            ) : null}
            {f.modo === "politica" ? (
              <Campo label="Cargo por no-show" ayuda="Por persona."><div className="aj-con-unidad"><input type="number" min={0} step={0.5} value={f.garantia_importe_pax} disabled={ro} onChange={(e) => set("garantia_importe_pax", e.target.value)} placeholder="20" /><span>€ / pers.</span></div></Campo>
            ) : (
              <Campo label="Prepago" ayuda="Por persona."><div className="aj-con-unidad"><input type="number" min={0} step={0.5} value={f.prepago_importe_pax} disabled={ro} onChange={(e) => set("prepago_importe_pax", e.target.value)} placeholder="30" /><span>€ / pers.</span></div></Campo>
            )}
            <Campo label="Política de cancelación" ayuda="Horas antes a partir de las cuales cancelar tiene cargo."><div className="aj-con-unidad"><input type="number" min={0} max={720} value={f.politica_cancelacion_horas} disabled={ro} onChange={(e) => set("politica_cancelacion_horas", e.target.value)} /><span>horas</span></div></Campo>
            <Campo label="Tiempo para meter la tarjeta" ayuda="Pasado, la reserva «tarjeta pendiente» caduca y libera la mesa."><div className="aj-con-unidad"><input type="number" min={5} max={1440} value={f.tarjeta_caduca_min} disabled={ro} onChange={(e) => set("tarjeta_caduca_min", e.target.value)} /><span>min</span></div></Campo>
          </div>
        ) : null}
        <div className="aj-aviso info" style={{ marginTop: 12, marginBottom: 0 }}>{resumen}</div>
      </Panel>

      <Panel titulo="No-show" texto="Qué hace el sistema cuando el cliente no aparece.">
        <div className="aj-interruptores">
          <Interruptor on={f.noshow_automatico} disabled={ro} onChange={(v) => set("noshow_automatico", v)} texto="Marcar no-show automáticamente al cerrar el turno si sigue sin llegar" />
          <Interruptor on={f.cobro_noshow_automatico} disabled={ro || f.modo !== "politica"} onChange={(v) => set("cobro_noshow_automatico", v)} texto={f.modo === "politica" ? "Cobrar la garantía automáticamente al marcar no-show (si no, se cobra a mano desde la reserva)" : "Cobro automático de no-show: solo con política de cancelación"} />
          <Interruptor on={f.envio_noshow} disabled={ro} onChange={(v) => set("envio_noshow", v)} texto="Enviar al cliente el mensaje de no-show (plantilla «No-show»)" />
        </div>
        <div className="mudo" style={{ fontSize: 12, marginTop: 10 }}>Las reservas confirmadas que lleven más de {rest.liberar_tras_min} min sin llegada pasan a «a revisar» (se cambia en Restaurante).</div>
      </Panel>

      <PieGuardar cambios={cambios && !ro} ocupado={ocupado} onGuardar={guardar} onDescartar={() => setF(JSON.parse(base) as Form)} />
    </>
  );
}
