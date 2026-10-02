"use client";

import { useState } from "react";
import { textos, type Lang } from "./textos";
import { emailValido, mensajeError, post } from "./lib-widget";

/**
 * «Invita a tus acompañantes» (plan §5, paso 4 de Cover). Hasta pax − 1 emails y un mensaje
 * corto; el servidor (/api/publico/reservas/gestion/invitar) encola un email 'invitacion' por
 * destinatario y lleva la cuenta de las ya enviadas. Se usa en la confirmación del widget y en
 * /reserva/<token>.
 */
export function Invitar({ token, pax, lang }: { token: string; pax: number; lang: Lang }) {
  const t = textos(lang);
  const max = Math.max(0, pax - 1);
  const [emails, setEmails] = useState<string[]>([""]);
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState<number | null>(null);
  const [quedan, setQuedan] = useState(max);

  if (max < 1) return null;

  async function enviar() {
    const lista = emails.map((e) => e.trim()).filter(Boolean);
    if (!lista.length || lista.some((e) => !emailValido(e))) return setError(t.errores.EMAIL_INVALIDO);
    setOcupado(true);
    setError("");
    const j = await post<{ ok?: boolean; enviados?: number; quedan?: number }>("/api/publico/reservas/gestion/invitar", { token, emails: lista, mensaje: mensaje.trim() });
    setOcupado(false);
    if (j.error) {
      if (j.error === "LIMITE_INVITACIONES") setQuedan(0);
      return setError(mensajeError(t.errores, j.error));
    }
    setHecho(j.enviados ?? lista.length);
    setQuedan(j.quedan ?? 0);
    setEmails([""]);
    setMensaje("");
  }

  return (
    <div className="card invitar">
      <h3 className="sec">{t.invitar}</h3>
      {hecho ? <div className="aviso ok">{t.invitadoOk(hecho)}</div> : null}
      {quedan > 0 ? (
        <>
          <p className="nota">{t.invitarSub(quedan)}</p>
          {emails.map((e, i) => (
            <div key={i} className="inv-fila">
              <input
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder={t.invitarEmailPh}
                aria-label={`${t.email} ${i + 1}`}
                value={e}
                onChange={(ev) => setEmails((xs) => xs.map((x, k) => (k === i ? ev.target.value : x)))}
              />
              {emails.length > 1 ? (
                <button type="button" className="inv-quitar" aria-label={t.quitar} onClick={() => setEmails((xs) => xs.filter((_, k) => k !== i))}>×</button>
              ) : null}
            </div>
          ))}
          {emails.length < quedan ? (
            <button type="button" className="enlace" onClick={() => setEmails((xs) => [...xs, ""])}>+ {t.invitarOtro}</button>
          ) : null}
          <label htmlFor="inv-msg">{t.invitarMensaje}</label>
          <textarea id="inv-msg" maxLength={300} placeholder={t.invitarMensajePh} value={mensaje} onChange={(ev) => setMensaje(ev.target.value)} />
          {error ? <div className="aviso err">{error}</div> : null}
          <button type="button" className="btn sec" disabled={ocupado} onClick={enviar}>
            {ocupado ? <span className="cargando" /> : null}
            {t.invitarEnviar}
          </button>
        </>
      ) : error ? (
        <div className="aviso err">{error}</div>
      ) : null}
    </div>
  );
}
