import "./pago.css";
import type { Metadata } from "next";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import {
  caducaEn,
  fmtEuros,
  modoDeReserva,
  MOTIVOS_DEVOLUCION_AUTO,
  pagosDeReserva,
  porDevolverAMano,
  reservaFutura,
  reservaPorToken,
  tokenValido,
  type Pago,
  type ReservaPago,
} from "@/lib/pagos-reservas";
import BotonPagar from "./BotonPagar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pago de la reserva",
  robots: { index: false, follow: false },
};

type Idioma = "es" | "en";

/** Textos de la página en los dos idiomas que manda el restaurante (idioma de la reserva). */
const TXT = {
  es: {
    marca: "Reservas",
    tituloGarantia: "Asegura tu reserva con tarjeta",
    tituloPrepago: "Completa el pago de tu reserva",
    subGarantia: "No se te cobrará nada ahora. Solo pedimos una tarjeta como garantía.",
    subPrepago: "Un pago anticipado que se descuenta de tu cuenta el día de la reserva.",
    restaurante: "Restaurante", fecha: "Fecha", hora: "Hora", personas: "Personas", localizador: "Localizador",
    importeGarantia: "Garantía", importePrepago: "Importe a pagar", porPersona: "por persona",
    politica: (h: number, imp: string) =>
      <>Solo si no te presentas o cancelas con <strong>menos de {h} horas</strong> de antelación se cargarán <strong>{imp}</strong> en la tarjeta.</>,
    plazo: (min: number) => `Tienes ${min} minutos para completar este paso; después la mesa se libera.`,
    candado: "Pago seguro en la pasarela de CaixaBank. Tu tarjeta nunca pasa por nuestros servidores.",
    condiciones: "Condiciones de reserva",
    verReserva: "Ver mi reserva",
    okGarantiaT: "Tarjeta registrada", okGarantiaP: "Tu reserva queda garantizada. Te llega la confirmación por email.",
    okPrepagoT: "Pago recibido", okPrepagoP: "Tu reserva queda confirmada. Te llega el justificante por email.",
    pendienteConf: "La reserva está pendiente de validación por el restaurante; te avisaremos en cuanto la confirmen.",
    esperaT: "Confirmando con el banco…", esperaP: "Estamos recibiendo la respuesta del banco. Esta página se actualiza sola en unos segundos.",
    koT: "No se ha completado", koP: "El banco no ha autorizado la operación o se ha cancelado. No se ha hecho ningún cargo. Puedes intentarlo de nuevo.",
    reintentar: "Intentarlo de nuevo",
    noValidoT: "Enlace no válido", noValidoP: "No encontramos ninguna reserva con este enlace. Revisa el email o SMS que te hemos enviado.",
    canceladaT: "Reserva cancelada", canceladaP: "Esta reserva se canceló (o el plazo para introducir la tarjeta terminó). Si quieres venir, haz una nueva reserva.",
    pasadaT: "Este enlace ya no está activo", pasadaP: "La fecha de la reserva ya ha pasado o la reserva no necesita tarjeta.",
    nuevaReserva: "Hacer una nueva reserva",
    devueltoT: "Reserva no disponible",
    devueltoP: (imp: string) => `El pago llegó cuando la reserva ya no estaba disponible, así que te hemos devuelto ${imp}. Verás el abono en tu tarjeta en unos días.`,
    canceladaDevueltaP: (imp: string) => `Reserva cancelada. Te hemos devuelto ${imp}. Verás el abono en tu tarjeta en unos días.`,
    canceladaPagoP: (imp: string) => `Tu pago de ${imp} está registrado; el restaurante te contactará para la devolución según sus condiciones.`,
    canceladaRevisarP: (imp: string) =>
      `Hemos recibido tu pago de ${imp}, pero la reserva ya no estaba disponible y la devolución automática no se ha podido completar. El restaurante lo revisará y te lo devolverá; no tienes que hacer nada.`,
    cargoT: "Cargo aplicado",
    cargoNoShowP: (imp: string) => `Se aplicó el cargo de ${imp} por no presentarse, según la política de la reserva.`,
    cargoTardiaP: (imp: string) => `Se aplicó el cargo de ${imp} por cancelar con menos antelación de la indicada en la política de la reserva.`,
    devueltoSimpleT: "Importe devuelto",
    devueltoSimpleP: (imp: string) => `Te hemos devuelto ${imp}. Verás el abono en tu tarjeta en unos días.`,
    tardaT: "Todavía no tenemos la respuesta del banco",
    tardaP: "Si la operación se ha completado, te llegará la confirmación por email en unos minutos. Puedes comprobarlo de nuevo aquí.",
    comprobar: "Comprobar de nuevo",
    tel: "Si tienes dudas, llámanos",
  },
  en: {
    marca: "Bookings",
    tituloGarantia: "Secure your booking with a card",
    tituloPrepago: "Complete your booking payment",
    subGarantia: "Nothing will be charged now. We only ask for a card as a guarantee.",
    subPrepago: "A prepayment that is deducted from your bill on the day of the booking.",
    restaurante: "Restaurant", fecha: "Date", hora: "Time", personas: "Guests", localizador: "Booking code",
    importeGarantia: "Guarantee", importePrepago: "Amount to pay", porPersona: "per person",
    politica: (h: number, imp: string) =>
      <>Only in case of no-show or cancellation with <strong>less than {h} hours</strong> notice will <strong>{imp}</strong> be charged to the card.</>,
    plazo: (min: number) => `You have ${min} minutes to complete this step; after that the table is released.`,
    candado: "Secure payment on the CaixaBank gateway. Your card never goes through our servers.",
    condiciones: "Booking terms",
    verReserva: "View my booking",
    okGarantiaT: "Card registered", okGarantiaP: "Your booking is guaranteed. A confirmation email is on its way.",
    okPrepagoT: "Payment received", okPrepagoP: "Your booking is confirmed. The receipt is on its way by email.",
    pendienteConf: "The booking is pending validation by the restaurant; we will let you know as soon as it is confirmed.",
    esperaT: "Confirming with the bank…", esperaP: "We are receiving the bank's response. This page refreshes itself in a few seconds.",
    koT: "Not completed", koP: "The bank did not authorise the operation or it was cancelled. Nothing has been charged. You can try again.",
    reintentar: "Try again",
    noValidoT: "Invalid link", noValidoP: "We could not find a booking for this link. Please check the email or SMS we sent you.",
    canceladaT: "Booking cancelled", canceladaP: "This booking was cancelled (or the time to add a card ran out). If you still want to come, please make a new booking.",
    pasadaT: "This link is no longer active", pasadaP: "The booking date has passed or the booking does not need a card.",
    nuevaReserva: "Make a new booking",
    devueltoT: "Booking not available",
    devueltoP: (imp: string) => `The payment arrived when the booking was no longer available, so we have refunded ${imp}. You will see it on your card in a few days.`,
    canceladaDevueltaP: (imp: string) => `Booking cancelled. We have refunded ${imp}. You will see it on your card in a few days.`,
    canceladaPagoP: (imp: string) => `Your payment of ${imp} is on record; the restaurant will contact you about the refund under its terms.`,
    canceladaRevisarP: (imp: string) =>
      `We received your payment of ${imp}, but the booking was no longer available and the automatic refund could not be completed. The restaurant will review it and refund you; you do not need to do anything.`,
    cargoT: "Charge applied",
    cargoNoShowP: (imp: string) => `A charge of ${imp} was applied for not showing up, as set out in the booking policy.`,
    cargoTardiaP: (imp: string) => `A charge of ${imp} was applied for cancelling with less notice than the booking policy requires.`,
    devueltoSimpleT: "Amount refunded",
    devueltoSimpleP: (imp: string) => `We have refunded ${imp}. You will see it on your card in a few days.`,
    tardaT: "We have not heard from the bank yet",
    tardaP: "If the payment went through, you will receive the confirmation by email in a few minutes. You can check again here.",
    comprobar: "Check again",
    tel: "Any questions? Call us",
  },
};

/** Lo que ha pasado con el dinero de la reserva, para elegir el texto (importes netos de devoluciones). */
function resumenDinero(pagos: Pago[]) {
  const objeto = (p: Pago) => (p.respuesta && typeof p.respuesta === "object" && !Array.isArray(p.respuesta) ? (p.respuesta as Record<string, unknown>) : {});
  const devs = pagos.filter((p) => p.tipo === "devolucion" && p.estado === "devuelto");
  const devueltoDe = (id: string) => devs.filter((d) => d.pago_origen_id === id).reduce((s, d) => s + Number(d.importe), 0);
  const netos = (tipo: string) =>
    pagos.filter((p) => p.tipo === tipo && p.estado === "cobrado").map((p) => ({ p, neto: Math.max(0, Number(p.importe) - devueltoDe(p.id)) })).filter((x) => x.neto > 0);
  const prepagos = netos("prepago");
  const cargos = netos("cargo_noshow");
  // Devoluciones automáticas (cobro tardío o duplicado): sin persona y con su motivo.
  const auto = devs.filter((d) => !d.creado_por && MOTIVOS_DEVOLUCION_AUTO.includes(String(objeto(d)._motivo ?? "")));
  return {
    prepagoVigente: prepagos.reduce((s, x) => s + x.neto, 0),
    aMano: prepagos.some((x) => porDevolverAMano(x.p)),
    cargoVigente: cargos.reduce((s, x) => s + x.neto, 0),
    cargoTardia: cargos.some((x) => objeto(x.p)._motivo === "cancelacion_tardia"),
    devuelto: devs.reduce((s, d) => s + Number(d.importe), 0),
    devueltoAuto: auto.reduce((s, d) => s + Number(d.importe), 0),
  };
}

function fechaLarga(iso: string, idioma: Idioma) {
  return new Date(iso + "T12:00:00").toLocaleDateString(idioma === "en" ? "en-GB" : "es-ES", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function Marco({ r, idioma, children }: { r: ReservaPago | null; idioma: Idioma; children: React.ReactNode }) {
  const rest = r?.reservas_restaurantes;
  const t = TXT[idioma];
  const estilo = rest?.color_marca ? ({ "--marca": rest.color_marca } as React.CSSProperties) : undefined;
  return (
    <main className="rvp" style={estilo}>
      <div className="wrap">
        <header className="top">
          {rest?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="logo" src={rest.logo_url} alt={rest.nombre} />
          ) : null}
          <div className="marca">
            {rest?.nombre ?? "Hostelero"}
            <small>{t.marca}</small>
          </div>
        </header>
        {children}
        <footer className="pie">
          {rest?.telefono ? (
            <p>
              {t.tel}: <a href={`tel:${rest.telefono.replace(/\s/g, "")}`}>{rest.telefono}</a>
            </p>
          ) : null}
        </footer>
      </div>
    </main>
  );
}

function Ficha({ r, idioma }: { r: ReservaPago; idioma: Idioma }) {
  const t = TXT[idioma];
  return (
    <dl className="ficha">
      <div className="ancho"><dt>{t.restaurante}</dt><dd>{r.reservas_restaurantes?.nombre}</dd></div>
      <div className="ancho"><dt>{t.fecha}</dt><dd>{fechaLarga(r.fecha, idioma)}</dd></div>
      <div><dt>{t.hora}</dt><dd>{r.hora.slice(0, 5)}</dd></div>
      <div><dt>{t.personas}</dt><dd>{r.pax}</dd></div>
      <div className="ancho"><dt>{t.localizador}</dt><dd className="loc">{r.localizador}</dd></div>
    </dl>
  );
}

export default async function PaginaPago({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ resultado?: string; n?: string }>;
}) {
  const { token: bruto } = await params;
  const sp = await searchParams;
  const token = (bruto || "").toLowerCase();
  const sb = crearClienteServicio();
  const r = sb && tokenValido(token) ? await reservaPorToken(sb, token) : null;
  const idioma: Idioma = r?.idioma === "en" ? "en" : "es";
  const t = TXT[idioma];

  if (!r || !sb) {
    return (
      <Marco r={null} idioma="es">
        <div className="card centro">
          <div className="icono ko">!</div>
          <h1>{t.noValidoT}</h1>
          <p className="sub">{t.noValidoP}</p>
          <a className="btn sec" href="/reservar-mesa">{t.nuevaReserva}</a>
        </div>
      </Marco>
    );
  }

  const rest = r.reservas_restaurantes;
  const modo = modoDeReserva(r);
  const pendiente = r.estado === "tarjeta_pendiente";
  const futura = reservaFutura(r, rest?.zona_horaria);
  const enlaceReserva = `/reserva/${r.token}`;

  // Cancelada (por el cliente, el restaurante o porque caducó la retención). Si hay dinero de
  // por medio se dice exactamente qué ha pasado con él: devuelto solo (pago tardío), devuelto por
  // el restaurante, cargo por cancelación tardía, o pago registrado pendiente de devolución.
  if (r.estado === "cancelada") {
    const d = r.estado_pago === "no_requerido" ? null : resumenDinero(await pagosDeReserva(sb, r.id));
    let titulo = t.canceladaT;
    let texto = t.canceladaP;
    if (d && d.prepagoVigente > 0) texto = d.aMano ? t.canceladaRevisarP(fmtEuros(d.prepagoVigente)) : t.canceladaPagoP(fmtEuros(d.prepagoVigente));
    else if (d && d.cargoVigente > 0) {
      titulo = t.cargoT;
      texto = d.cargoTardia ? t.cargoTardiaP(fmtEuros(d.cargoVigente)) : t.cargoNoShowP(fmtEuros(d.cargoVigente));
    } else if (d && d.devuelto > 0) {
      // El texto de «pago tardío» solo si TODO lo devuelto fue automático.
      const auto = d.devueltoAuto > 0 && d.devueltoAuto >= d.devuelto;
      titulo = auto ? t.devueltoT : t.canceladaT;
      texto = auto ? t.devueltoP(fmtEuros(d.devuelto)) : t.canceladaDevueltaP(fmtEuros(d.devuelto));
    }
    return (
      <Marco r={r} idioma={idioma}>
        <div className="card centro">
          <div className="icono ko">✕</div>
          <h1>{titulo}</h1>
          <p className="sub">{texto}</p>
          <a className="btn sec" href={rest?.slug ? `/reservar-mesa/${rest.slug}` : "/reservar-mesa"}>{t.nuevaReserva}</a>
        </div>
      </Marco>
    );
  }

  const hecho = r.estado_pago === "garantizada" || r.estado_pago === "pagada";
  if (hecho) {
    const esGarantia = r.estado_pago === "garantizada";
    return (
      <Marco r={r} idioma={idioma}>
        <div className="card centro">
          <div className="icono ok">✓</div>
          <h1>{esGarantia ? t.okGarantiaT : t.okPrepagoT}</h1>
          <p className="sub">{esGarantia ? t.okGarantiaP : t.okPrepagoP}</p>
          {r.estado === "pendiente" ? <div className="aviso info">{t.pendienteConf}</div> : null}
        </div>
        <div className="card"><Ficha r={r} idioma={idioma} /></div>
        <a className="btn sec" href={enlaceReserva}>{t.verReserva}</a>
      </Marco>
    );
  }

  // Vuelta del banco con OK pero la notificación aún no ha llegado: esperamos recargando cada
  // 4 s (unos 40 s como mucho); si el último intento consta denegado, se trata como KO.
  let ko = sp.resultado === "ko";
  if (sp.resultado === "ok" && pendiente) {
    const ultimo = (await pagosDeReserva(sb, r.id)).find((p) => p.tipo === "garantia" || p.tipo === "prepago");
    if (ultimo?.estado === "fallido") ko = true;
    else if (!ultimo || ultimo.estado === "iniciado") {
      const n = Math.max(0, parseInt(sp.n || "0", 10) || 0);
      if (n < 10) {
        return (
          <Marco r={r} idioma={idioma}>
            <meta httpEquiv="refresh" content={`4;url=/reserva/${r.token}/pago?resultado=ok&n=${n + 1}`} />
            <div className="card centro" aria-live="polite">
              <div className="icono espera"><span className="cargando" aria-hidden /></div>
              <h1>{t.esperaT}</h1>
              <p className="sub">{t.esperaP}</p>
            </div>
          </Marco>
        );
      }
      return (
        <Marco r={r} idioma={idioma}>
          <div className="card centro">
            <div className="icono espera">…</div>
            <h1>{t.tardaT}</h1>
            <p className="sub">{t.tardaP}</p>
            <a className="btn" href={`/reserva/${r.token}/pago?resultado=ok`}>{t.comprobar}</a>
          </div>
        </Marco>
      );
    }
  }

  if (!pendiente || !modo || !futura) {
    // Cargo por no-show o devolución: se dice qué ha pasado con el dinero, no «ya está hecho».
    let titulo = t.pasadaT;
    let texto = t.pasadaP;
    if (r.estado_pago === "cobrado_noshow" || r.estado_pago === "devuelto") {
      const d = resumenDinero(await pagosDeReserva(sb, r.id));
      if (r.estado_pago === "cobrado_noshow" && d.cargoVigente > 0) {
        titulo = t.cargoT;
        texto = d.cargoTardia ? t.cargoTardiaP(fmtEuros(d.cargoVigente)) : t.cargoNoShowP(fmtEuros(d.cargoVigente));
      } else if (d.devuelto > 0) {
        titulo = t.devueltoSimpleT;
        texto = t.devueltoSimpleP(fmtEuros(d.devuelto));
      }
    }
    return (
      <Marco r={r} idioma={idioma}>
        <div className="card centro">
          <div className="icono ko">!</div>
          <h1>{titulo}</h1>
          <p className="sub">{texto}</p>
          <a className="btn sec" href={enlaceReserva}>{t.verReserva}</a>
        </div>
      </Marco>
    );
  }

  // Pendiente de tarjeta y a tiempo: la pantalla principal.
  const horas = rest?.politica_cancelacion_horas ?? 24;
  const esGarantia = modo.modo === "garantia";
  const porPersona = r.pax > 0 ? modo.importe / r.pax : modo.importe;
  const minutos = Math.round((caducaEn(r, rest?.tarjeta_caduca_min) - Date.now()) / 60000);

  return (
    <Marco r={r} idioma={idioma}>
      {ko ? (
        <div className="aviso err" role="alert">
          <strong>{t.koT}.</strong> {t.koP}
        </div>
      ) : null}
      <h1>{esGarantia ? t.tituloGarantia : t.tituloPrepago}</h1>
      <p className="sub">{esGarantia ? t.subGarantia : t.subPrepago}</p>

      <div className="card">
        <Ficha r={r} idioma={idioma} />
        <div className="importe">
          <div>
            <span className="eti">{esGarantia ? t.importeGarantia : t.importePrepago}</span>
            <div className="n">{fmtEuros(modo.importe)}</div>
          </div>
          {r.pax > 1 ? (
            <div className="d">
              {fmtEuros(porPersona)} {t.porPersona} × {r.pax}
            </div>
          ) : null}
        </div>
        {esGarantia ? <div className="politica">{t.politica(horas, fmtEuros(modo.importe))}</div> : null}
      </div>

      <BotonPagar token={r.token ?? token} modo={modo.modo} idioma={idioma} />
      <p className="candado">
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>{" "}
        {t.candado}
      </p>
      {minutos > 0 ? <p className="candado">{t.plazo(minutos)}</p> : null}
      {rest?.url_condiciones ? (
        <p className="centro" style={{ marginTop: 14 }}>
          <a className="enlace" href={rest.url_condiciones} target="_blank" rel="noreferrer">{t.condiciones}</a>
        </p>
      ) : null}
    </Marco>
  );
}
