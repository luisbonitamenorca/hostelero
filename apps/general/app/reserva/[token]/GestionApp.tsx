"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendario } from "../../reservar-mesa/Calendario";
import { Invitar } from "../../reservar-mesa/Invitar";
import { LANGS, NOMBRE_IDIOMA, esLang, textos, type Lang } from "../../reservar-mesa/textos";
import { ahoraHHMM, detectarIdioma, estiloMarca, fmtFechaLarga, fmtImporte, horasEntre, hoyISO, mensajeError, pedir, post, sumarDias, urlMapa, urlWhatsApp, type DispV2, type Gestion } from "../../reservar-mesa/lib-widget";

/**
 * Gestión de la reserva por el cliente. Lee /api/publico/reservas/gestion?token= y ofrece solo
 * lo que el RPC permite (puede_confirmar / puede_modificar / puede_cancelar / puede_pagar /
 * puede_valorar). Los enlaces del email pueden traer ?accion=confirmar|cancelar|modificar para
 * abrir directamente ese panel.
 */
type Panel = null | "modificar" | "cancelar";

function claseEstado(estado: string) {
  if (["confirmada", "reconfirmada", "llegada", "sentada", "postre", "cuenta", "terminada", "a_revisar"].includes(estado)) return "ok";
  if (["pendiente", "tarjeta_pendiente", "lista_espera"].includes(estado)) return "ambar";
  if (["cancelada", "no_show"].includes(estado)) return "err";
  return "";
}

export default function GestionApp({ token, lang: langUrl, accion }: { token: string; lang: Lang | null; accion: "confirmar" | "cancelar" | "modificar" | null }) {
  const [lang, setLang] = useState<Lang>(langUrl ?? "es");
  const t = textos(lang);
  const [g, setG] = useState<Gestion | null>(null);
  const [estado, setEstado] = useState<"cargando" | "ok" | "no">("cargando");
  const [panel, setPanel] = useState<Panel>(accion === "cancelar" ? "cancelar" : accion === "modificar" ? "modificar" : null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  // Modificar.
  const [mFecha, setMFecha] = useState("");
  const [mPax, setMPax] = useState(2);
  const [mHora, setMHora] = useState<string | null>(null);
  const [mDisp, setMDisp] = useState<DispV2 | null>(null);
  const [mCargando, setMCargando] = useState(false);
  // Cancelar.
  const [motivo, setMotivo] = useState("");
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    if (!langUrl) setLang(detectarIdioma(null));
  }, [langUrl]);

  async function cargar() {
    if (!token) {
      setEstado("no");
      return;
    }
    const j = await pedir<Gestion>(`/api/publico/reservas/gestion?token=${token}`);
    if (j.error || !j.ok) {
      setEstado("no");
      return;
    }
    setG(j);
    setMFecha(j.fecha_iso);
    setMPax(j.pax);
    setMHora(j.hora);
    if (!langUrl && esLang(j.idioma)) setLang(j.idioma);
    setEstado("ok");
  }
  useEffect(() => {
    cargar();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?accion=confirmar desde el email: reconfirmamos nada más cargar.
  const [autoConfirmado, setAutoConfirmado] = useState(false);
  useEffect(() => {
    if (accion === "confirmar" && g?.puede_confirmar && !autoConfirmado) {
      setAutoConfirmado(true);
      reconfirmar();
    }
  }, [g, accion]); // eslint-disable-line react-hooks/exhaustive-deps

  async function reconfirmar() {
    setOcupado(true);
    setError("");
    const j = await post<{ ok?: boolean; estado?: string }>("/api/publico/reservas/gestion/confirmar", { token });
    setOcupado(false);
    if (j.error) return setError(mensajeError(t.errores, j.error));
    // Pendiente (p. ej. solicitud de grupo): el RPC solo anota la reconfirmación; el restaurante
    // todavía no la ha aceptado y no queremos que el cliente crea que sí.
    setAviso(j.estado === "pendiente" ? t.reconfirmadaPendiente : t.reconfirmada);
    cargar();
  }

  async function cancelar() {
    setOcupado(true);
    setError("");
    const j = await post<{ ok?: boolean; cargo_aplicable?: boolean; importe?: number | null }>("/api/publico/reservas/gestion/cancelar", { token, motivo: motivo.trim() });
    setOcupado(false);
    if (j.error) return setError(mensajeError(t.errores, j.error));
    setPanel(null);
    setConfirmando(false);
    setAviso(t.canceladaOk);
    cargar();
  }

  async function buscarHoras(fecha = mFecha, pax = mPax) {
    if (!g) return;
    setMCargando(true);
    setMHora(fecha === g.fecha_iso ? g.hora : null);
    const j = await pedir<DispV2>(`/api/publico/reservas/disponibilidad-v2?slug=${encodeURIComponent(g.restaurante.slug)}&fecha=${fecha}&pax=${pax}`);
    setMDisp(j);
    setMCargando(false);
  }
  useEffect(() => {
    if (panel === "modificar" && g) buscarHoras();
  }, [panel, mFecha, mPax]); // eslint-disable-line react-hooks/exhaustive-deps

  async function modificar() {
    if (!mHora) return;
    setOcupado(true);
    setError("");
    const j = await post<{ ok?: boolean; sin_cambios?: boolean }>("/api/publico/reservas/gestion/modificar", { token, fecha: mFecha, hora: mHora, pax: mPax });
    setOcupado(false);
    if (j.error) return setError(mensajeError(t.errores, j.error));
    setPanel(null);
    setAviso(j.sin_cambios ? t.sinCambios : t.modificadaOk);
    cargar();
  }

  const estilo = useMemo(() => estiloMarca(g?.restaurante.color_marca), [g?.restaurante.color_marca]);
  const hoy = hoyISO();

  // Horas de la modificación. La disponibilidad pública cuenta la propia reserva como ocupada
  // (reservas_disponibilidad_v2 aún no admite excluirla), así que en una noche llena retrasar
  // 30 min o pasar de 2 a 3 saldría «sin mesa» aunque reservas_gestion_modificar sí lo acepta.
  // Mientras llega p_excluir: el mismo día ofrecemos todas las horas de los turnos abiertos y
  // que valide el RPC de modificar (su SIN_DISPONIBILIDAD se enseña tal cual).
  const horasMod = useMemo(() => {
    if (!mDisp || !g) return [] as { turno: string; horas: { hora: string; pocas: boolean }[] }[];
    const mismoDia = mFecha === g.fecha_iso;
    const ahora = mFecha === hoyISO() ? ahoraHHMM() : "";
    return (mDisp.turnos ?? [])
      .map((tu) => {
        const hs = (tu.horas ?? []).map((h) => ({ hora: h.hora, pocas: h.pocas }));
        if (mismoDia && !tu.cerrado && !tu.grupo_grande && tu.hora_inicio && tu.hora_fin) {
          for (const h of horasEntre(tu.hora_inicio, tu.hora_fin, tu.intervalo_min ?? 15)) {
            if (h > ahora && !hs.some((x) => x.hora === h)) hs.push({ hora: h, pocas: false });
          }
          hs.sort((a, b) => a.hora.localeCompare(b.hora));
        }
        return { turno: tu.turno, horas: hs };
      })
      .filter((tu) => tu.horas.length);
  }, [mDisp, g, mFecha]);

  const cabecera = (
    <header className="top">
      <div className="marca">
        {g?.restaurante.logo_url ? <img src={g.restaurante.logo_url} alt="" className="logo" /> : null}
        <span>{g?.restaurante.nombre ?? t.marca}</span>
        {g ? <small>{t.marca}</small> : null}
      </div>
      <div className="idiomas" role="group" aria-label={t.idiomaAria}>
        {LANGS.map((l) => (
          <button key={l} type="button" lang={l} title={NOMBRE_IDIOMA[l]} className={lang === l ? "on" : ""} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
        ))}
      </div>
    </header>
  );

  if (estado === "cargando") {
    return (
      <div className="rme"><div className="wrap">{cabecera}<div className="aviso info"><span className="cargando" />{t.cargando}</div></div></div>
    );
  }
  if (estado === "no" || !g) {
    return (
      <div className="rme">
        <div className="wrap">
          {cabecera}
          <h2 className="paso">{t.noEncontrada}</h2>
          <p className="sub">{t.noEncontradaSub}</p>
          <a className="btn sec" href={`/reservar-mesa?lang=${lang}`}>{t.otraReserva}</a>
        </div>
      </div>
    );
  }

  const r = g.restaurante;
  const cancelada = g.estado === "cancelada";
  const pasada = !cancelada && g.fecha_iso < hoy;
  const textoCompartir = `${r.nombre} · ${g.fecha} ${g.hora} h · ${g.pax} ${t.pers} · ${t.localizador} ${g.localizador}`;
  const telWa = r.telefono;
  // Al subir comensales por encima del máximo online, el RPC marca los turnos como grupo grande.
  const grupoMod = (mDisp?.turnos ?? []).some((tu) => tu.grupo_grande);
  const telGrupos = mDisp?.grupos_telefono || r.telefono || "";

  return (
    <div className="rme" style={estilo}>
      <div className="wrap">
        {cabecera}
        <h2 className="paso">{t.tuReserva}</h2>
        <p className="sub">{t.localizador} <strong className="mono">{g.localizador}</strong></p>

        {aviso ? <div className="aviso ok">{aviso}</div> : null}
        {cancelada ? <div className="aviso err">{t.canceladaYa}</div> : null}
        {pasada ? <div className="aviso info">{t.reservaPasada}</div> : null}
        {g.puede_pagar ? (
          <div className="aviso ambar">
            {t.pagoPendiente}{" "}
            <a href={`/reserva/${token}/pago?lang=${lang}`}>{t.pagarAhora}</a>
          </div>
        ) : null}

        <div className="card ficha">
          <span className={`estado ${claseEstado(g.estado)}`}>{t.estados[g.estado] || g.estado}</span>
          <dl>
            <div><dt>{t.dia}</dt><dd className="cap">{fmtFechaLarga(g.fecha_iso, lang)}</dd></div>
            <div><dt>{t.hora}</dt><dd>{g.hora} h</dd></div>
            <div><dt>{t.comensales}</dt><dd>{g.pax}</dd></div>
            {g.zona ? <div><dt>{t.zona}</dt><dd>{g.zona}</dd></div> : null}
            {g.experiencia ? <div className="ancho"><dt>{t.experiencia}</dt><dd>{g.experiencia}</dd></div> : null}
            {g.importe && g.tipo !== "gratis" ? <div><dt>{g.tipo === "prepago" || g.tipo === "experiencia" ? t.prepagoEtq : t.garantiaEtq}</dt><dd>{fmtImporte(g.importe, lang)}</dd></div> : null}
            {g.alergias ? <div className="ancho"><dt>{t.alergias}</dt><dd>{g.alergias}</dd></div> : null}
            {g.notas_cliente ? <div className="ancho"><dt>{t.comentario}</dt><dd>{g.notas_cliente}</dd></div> : null}
          </dl>
          {r.mensaje ? <p className="nota">{r.mensaje}</p> : null}
          {!cancelada ? (
            <div className="acciones-ticket">
              {g.ics ? <a href={g.ics} download>{t.anadirCalendario}</a> : null}
              {r.direccion ? <a href={urlMapa(r.direccion)} target="_blank" rel="noopener noreferrer">{t.comoLlegar}</a> : null}
              <a href={urlWhatsApp(textoCompartir)} target="_blank" rel="noopener noreferrer">{t.compartirWhatsApp}</a>
              {g.puede_valorar ? <a href={`/valorar/${token}?lang=${lang}`}>{t.valorar}</a> : null}
            </div>
          ) : null}
        </div>

        {error && !panel ? <div className="aviso err">{error}</div> : null}

        {(g.puede_confirmar || g.puede_modificar || g.puede_cancelar) && !panel ? (
          <div className="acciones">
            {g.puede_confirmar ? <button className="btn" disabled={ocupado} onClick={reconfirmar}>{t.reconfirmar}</button> : null}
            {g.puede_modificar ? <button className="btn sec" disabled={ocupado} onClick={() => { setError(""); setPanel("modificar"); }}>{t.modificar}</button> : null}
            {g.puede_cancelar ? <button className="btn peligro" disabled={ocupado} onClick={() => { setError(""); setConfirmando(false); setPanel("cancelar"); }}>{t.cancelarReserva}</button> : null}
          </div>
        ) : null}

        {panel === "modificar" && g.puede_modificar ? (
          <div className="card">
            <h3 className="sec">{t.modificarTitulo}</h3>
            <label>{t.comensales}</label>
            <div className="pax">
              <button type="button" disabled={mPax <= 1} onClick={() => setMPax(mPax - 1)} aria-label="−">−</button>
              <input type="number" inputMode="numeric" min={1} max={50} value={mPax} onChange={(ev) => setMPax(Math.max(1, Math.min(50, parseInt(ev.target.value || "1", 10) || 1)))} aria-label={t.comensales} />
              <button type="button" disabled={mPax >= 50} onClick={() => setMPax(mPax + 1)} aria-label="+">+</button>
            </div>
            <label>{t.dia}</label>
            <Calendario slug={r.slug} valor={mFecha} onChange={(iso) => setMFecha(iso)} lang={lang} min={hoy} max={sumarDias(hoy, 365)} pax={mPax} leyenda={false} />
            <label>{t.hora}</label>
            {mCargando ? <div className="aviso info"><span className="cargando" />{t.buscando}</div> : null}
            {!mCargando && mDisp?.error ? <div className="aviso err">{mensajeError(t.errores, mDisp.error)}</div> : null}
            {!mCargando && mDisp?.cerrado ? <div className="aviso info">{t.diaCerrado}</div> : null}
            {!mCargando && !mDisp?.error && !mDisp?.cerrado && !horasMod.length ? (
              grupoMod ? (
                <div className="aviso ambar">
                  {t.grupoModificar}{" "}
                  {telGrupos ? <>{t.llamanos} <a href={`tel:${telGrupos.replace(/\s/g, "")}`}>{telGrupos}</a>.</> : null}
                </div>
              ) : (
                <div className="aviso info">{t.sinHueco}</div>
              )
            ) : null}
            {horasMod.map((tu) => (
              <div key={tu.turno} className="turno-bloque">
                <div className="turno-cab"><span className="turno-nombre">{tu.turno}</span></div>
                <div className="horas">
                  {tu.horas.map((h) => (
                    <button key={h.hora} type="button" className={`hora-chip ${mHora === h.hora ? "sel" : ""} ${h.pocas ? "pocas" : ""}`} onClick={() => setMHora(h.hora)} aria-pressed={mHora === h.hora}>
                      {h.hora}
                      {h.pocas ? <small>{t.pocasPlazas}</small> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {error ? <div className="aviso err">{error}</div> : null}
            <button className="btn" disabled={ocupado || !mHora} onClick={modificar}>{t.guardarCambios}</button>
            <button className="btn sec" disabled={ocupado} onClick={() => { setPanel(null); setError(""); }}>{t.volver}</button>
          </div>
        ) : null}

        {panel === "cancelar" && g.puede_cancelar ? (
          <div className="card">
            <h3 className="sec">{t.cancelarReserva}</h3>
            {g.cargo_si_cancela && g.importe ? (
              <div className="aviso ambar">{t.avisoCargo(fmtImporte(g.importe, lang), r.politica_cancelacion_horas)}</div>
            ) : g.dentro_politica ? (
              <div className="aviso ambar">{t.avisoPlazo(r.politica_cancelacion_horas)}</div>
            ) : null}
            <label htmlFor="c-motivo">{t.motivoCancelacion}</label>
            <textarea id="c-motivo" placeholder={t.motivoPh} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} maxLength={1000} />
            {error ? <div className="aviso err">{error}</div> : null}
            {!confirmando ? (
              <button className="btn peligro" disabled={ocupado} onClick={() => setConfirmando(true)}>{t.cancelarReserva}</button>
            ) : (
              <button className="btn peligro lleno" disabled={ocupado} onClick={cancelar}>{t.confirmarCancelacion}</button>
            )}
            <button className="btn sec" disabled={ocupado} onClick={() => { setPanel(null); setConfirmando(false); setError(""); }}>{t.mantener}</button>
          </div>
        ) : null}

        {g.puede_cancelar && g.estado !== "tarjeta_pendiente" && g.pax > 1 && !panel ? <Invitar token={token} pax={g.pax} lang={lang} /> : null}

        <div className="card">
          <h3 className="sec">{t.politica}</h3>
          <p className="texto" style={{ fontSize: 14, color: "var(--gris)" }}>{t.politicaInfo(r.politica_cancelacion_horas)}</p>
          {r.url_condiciones ? <a className="enlace" href={r.url_condiciones} target="_blank" rel="noopener noreferrer">{t.condicionesLink}</a> : null}
          <h3 className="sec" style={{ marginTop: 16 }}>{t.contacto}</h3>
          <div className="contacto">
            <strong>{r.nombre}</strong>
            {r.direccion ? <span>{r.direccion}</span> : null}
            {r.telefono ? <a href={`tel:${r.telefono.replace(/\s/g, "")}`}>{r.telefono}</a> : null}
            {r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : null}
            {telWa ? <a href={urlWhatsApp(`${t.localizador} ${g.localizador}`, telWa)} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
          </div>
        </div>

        <p className="pie"><a href={`/reservar-mesa/${r.slug}?lang=${lang}`} style={{ color: "var(--acento)", fontWeight: 600 }}>{t.otraReserva}</a></p>
      </div>
    </div>
  );
}
