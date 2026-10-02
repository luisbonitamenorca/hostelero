"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendario, diasAbiertosCerca } from "./Calendario";
import { Invitar } from "./Invitar";
import { LANGS, NOMBRE_IDIOMA, esLang, textos, type Lang } from "./textos";
import {
  PREFIJOS,
  detectarIdioma,
  emailValido,
  estiloMarca,
  fmtFechaLarga,
  fmtImporte,
  horasEntre,
  hoyISO,
  isoDesdeDdmm,
  locale,
  mensajeError,
  pedir,
  post,
  prefijoInicial,
  sumarDias,
  telefonoCompleto,
  telefonoValido,
  urlMapa,
  urlWhatsApp,
  type DispV2,
  type EstadoDia,
  type Experiencia,
  type Local,
  type Pregunta,
  type Ticket,
  type TurnoV2,
} from "./lib-widget";

/**
 * Widget público de reserva de mesa, en cuatro pasos (como Cover, con la marca de la casa):
 *  1 Encontrar (restaurante, comensales, día) · 2 Hora (turnos, zona, experiencia) ·
 *  3 Datos · 4 Confirmación. Lista de espera (del día o de un turno lleno) y solicitud de grupo
 *  grande salen del paso 2. En la confirmación: invitar a los acompañantes.
 * Todo pasa por los handlers de /api/publico/reservas/* (sin sesión, sin claves en el cliente).
 */

export type Inicial = { fecha?: string; hora?: string; pax?: number; espera?: string; exp?: string };
type Vista = "inicio" | "horas" | "datos" | "ticket" | "espera" | "esperaOk";
type Catalogo = { experiencias: Experiencia[]; preguntas: Pregunta[] };
type Respuesta = boolean | string | string[];

export default function ReservarMesaApp({ slugFijo, lang: langUrl, prescriptor, inicial }: { slugFijo: string | null; lang: Lang | null; prescriptor: string | null; inicial: Inicial }) {
  // Sin ?lang= arrancamos en español (igual en servidor y cliente) y afinamos con el navegador al montar.
  const [lang, setLang] = useState<Lang>(langUrl ?? "es");
  const t = textos(lang);

  const [vista, setVista] = useState<Vista>("inicio");
  const [locales, setLocales] = useState<Local[] | null>(null);
  const [local, setLocal] = useState<Local | null>(null);
  const [pax, setPax] = useState(inicial.pax && inicial.pax > 0 ? inicial.pax : 2);
  const [paxLibre, setPaxLibre] = useState(false);
  const [fecha, setFecha] = useState(inicial.fecha && inicial.fecha >= hoyISO() ? inicial.fecha : "");
  const [estadoFecha, setEstadoFecha] = useState<EstadoDia>("abierto");
  const [zona, setZona] = useState<string | null>(null);
  const [exp, setExp] = useState<string | null>(inicial.exp ?? null);
  const [disp, setDisp] = useState<DispV2 | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [hora, setHora] = useState<string | null>(null);
  const [solicitud, setSolicitud] = useState(false);
  const [horaGrupo, setHoraGrupo] = useState("");
  const [cross, setCross] = useState<{ local: Local; n: number }[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  // Aviso que sobrevive a la nueva búsqueda (p. ej. «justo se ha ocupado esa hora» al volver al paso 2).
  const [avisoHoras, setAvisoHoras] = useState("");
  // Solicitud de grupo rechazada por cupo: hay que llamar (no tiene sentido reintentar).
  const [avisoGrupo, setAvisoGrupo] = useState(false);
  // Días cercanos con hueco cuando el elegido no tiene (tira de días del plan §2.3).
  const [cercanos, setCercanos] = useState<string[]>([]);
  const busquedaRef = useRef(0); // descarta respuestas de búsquedas anteriores
  const [presc, setPresc] = useState<{ nombre: string } | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);

  // Formulario de datos.
  const [f, setF] = useState({
    nombre: "",
    apellidos: "",
    prefijo: "34",
    telefono: "",
    email: "",
    idioma: (langUrl ?? "es") as string,
    comentario: "",
    alergiasSi: false,
    alergias: "",
    verCodigo: false,
    codigo: "",
    marketing: false,
    condiciones: false,
    respuestas: {} as Record<string, Respuesta>,
  });
  const setCampo = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  // Lista de espera.
  const [e, setE] = useState({ nombre: "", prefijo: "34", telefono: "", email: "", turno: "", hora: "", notas: "" });
  const setCampoE = <K extends keyof typeof e>(k: K, v: (typeof e)[K]) => setE((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    const l = langUrl ?? detectarIdioma(null);
    if (l !== lang) {
      setLang(l);
      setF((x) => ({ ...x, idioma: l }));
    }
    const p = prefijoInicial(l);
    setF((x) => ({ ...x, prefijo: p }));
    setE((x) => ({ ...x, prefijo: p }));
  }, [langUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const ir = useCallback((v: Vista) => {
    setVista(v);
    setError("");
    setAvisoGrupo(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  /* ───────── carga inicial: restaurantes y prescriptor ───────── */
  useEffect(() => {
    pedir<{ restaurantes?: Local[] }>("/api/publico/reservas/restaurantes").then((j) => {
      const ls = (j.restaurantes ?? []).filter((r) => r.online_activo);
      setLocales(ls);
      if (slugFijo) {
        setLocal(ls.find((r) => r.slug === slugFijo) ?? null);
      }
    });
    if (prescriptor) pedir<{ ok: boolean; nombre?: string }>(`/api/publico/reservas/prescriptor?p=${encodeURIComponent(prescriptor)}`).then((j) => setPresc(j.ok && j.nombre ? { nombre: j.nombre } : null));
  }, [slugFijo, prescriptor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enlace de la lista de espera (?fecha&hora&pax&espera): vamos directos al paso de hora.
  const [autoBuscado, setAutoBuscado] = useState(false);
  useEffect(() => {
    if (autoBuscado || !local || !inicial.fecha) return;
    setAutoBuscado(true);
    buscar(local, zona, exp, inicial.hora ?? null);
  }, [local]); // eslint-disable-line react-hooks/exhaustive-deps

  // Con otro restaurante el estado del día elegido ya no vale; con otros comensales lo vuelve a
  // decir el calendario en cuanto tiene los datos (onEstadoValor).
  useEffect(() => setEstadoFecha("abierto"), [local?.slug]);

  const maxOnline = local?.max_pax_online ?? 8;
  const hoy = hoyISO();
  const fechaMax = local ? sumarDias(hoy, local.antelacion_max_dias || 60) : sumarDias(hoy, 60);

  /* ───────── paso 1 → 2: disponibilidad ───────── */
  async function buscar(l?: Local | null, z: string | null = zona, x: string | null = exp, horaPre: string | null = null, f: string = fecha): Promise<void> {
    const loc = l ?? local;
    if (!loc || !f) return;
    if (l && l !== local) setLocal(l);
    if (f !== fecha) setFecha(f);
    setCargando(true);
    setError("");
    setAvisoHoras("");
    setHora(null);
    setSolicitud(false);
    setCross(null);
    setCercanos([]);
    const fecha_ = f;
    const n = ++busquedaRef.current;
    try {
      const q = new URLSearchParams({ slug: loc.slug, fecha: fecha_, pax: String(pax) });
      if (z) q.set("zona", z);
      if (x) q.set("experiencia", x);
      const [j, cat] = await Promise.all([
        pedir<DispV2>(`/api/publico/reservas/disponibilidad-v2?${q}`),
        // Las experiencias dependen de fecha y pax: se recargan con cada búsqueda.
        pedir<Catalogo>(`/api/publico/reservas/experiencias?slug=${encodeURIComponent(loc.slug)}&fecha=${fecha_}&pax=${pax}`),
      ]);
      if (j.error === "ZONA_INVALIDA" || j.error === "EXPERIENCIA_NO_DISPONIBLE") {
        // La zona/experiencia venía de otro restaurante o ya no vale: reintentamos sin ella.
        setZona(null);
        setExp(null);
        setCargando(false);
        return buscar(loc, null, null, horaPre, fecha_);
      }
      setDisp(j);
      setCatalogo(cat.error ? { experiencias: [], preguntas: [] } : cat);
      ir("horas");
      const horas = (j.turnos ?? []).flatMap((tu) => tu.horas ?? []);
      if (horaPre && horas.some((h) => h.hora === horaPre)) setHora(horaPre);
      // Cross-selling: si no hay ninguna hora y no es tema de grupo, miramos el resto del grupo.
      const grupo = (j.turnos ?? []).some((tu) => tu.grupo_grande);
      // Y días cercanos con hueco en este restaurante (del calendario ya cacheado, o una petición).
      if (!j.error && !horas.length && !grupo) {
        diasAbiertosCerca(loc.slug, pax, fecha_).then((ds) => {
          if (busquedaRef.current === n) setCercanos(ds);
        });
      }
      if (!j.error && !j.cerrado && !horas.length && !grupo && !slugFijo) {
        const otros = (locales ?? []).filter((o) => o.slug !== loc.slug && o.online_activo);
        const conMesa: { local: Local; n: number }[] = [];
        await Promise.all(
          otros.map(async (o) => {
            const jj = await pedir<DispV2>(`/api/publico/reservas/disponibilidad-v2?slug=${encodeURIComponent(o.slug)}&fecha=${fecha_}&pax=${pax}`);
            if (!jj.error && !jj.cerrado) {
              const hs = (jj.turnos ?? []).flatMap((tu) => tu.horas ?? []);
              if (hs.length) conMesa.push({ local: o, n: hs.length });
            }
          }),
        );
        setCross(conMesa);
      }
    } finally {
      setCargando(false);
    }
  }

  function cambiarZona(z: string | null) {
    setZona(z);
    buscar(undefined, z, exp);
  }
  function cambiarExp(x: string | null) {
    setExp(x);
    buscar(undefined, zona, x);
  }

  /* ───────── paso 3 → 4: crear ───────── */
  const preguntas = catalogo?.preguntas ?? [];
  const tipoPago = disp?.tipo ?? null;
  const importe = disp?.importe ?? null;

  function validarDatos(): string {
    if (!f.nombre.trim()) return t.errores.NOMBRE_REQUERIDO;
    if (!telefonoValido(f.prefijo, f.telefono)) return t.errores.TELEFONO_INVALIDO;
    if (!emailValido(f.email)) return t.errores.EMAIL_INVALIDO;
    for (const p of preguntas) {
      if (!p.obligatoria) continue;
      const v = f.respuestas[p.id];
      if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) return `${t.obligatorio}: ${textoPregunta(p, lang)}`;
    }
    if (!f.condiciones) return t.errores.CONDICIONES_REQUERIDAS;
    return "";
  }

  async function crear() {
    const err = validarDatos();
    if (err) return setError(err);
    if (!local || !hora) return;
    setCargando(true);
    setError("");
    const j = await post<Ticket>("/api/publico/reservas/crear-v2", {
      slug: local.slug,
      fecha,
      hora,
      pax,
      nombre: f.nombre.trim(),
      apellidos: f.apellidos.trim(),
      telefono: telefonoCompleto(f.prefijo, f.telefono),
      email: f.email.trim(),
      idioma: esLang(f.idioma) ? f.idioma : lang,
      pais: PREFIJOS.find((p) => p.codigo === f.prefijo)?.pais ?? "ES",
      notas: f.comentario.trim(),
      alergias: f.alergiasSi ? f.alergias.trim() : "",
      zona_id: zona,
      experiencia_id: exp,
      prescriptor: presc ? prescriptor : "",
      codigo_promo: f.codigo.trim(),
      respuestas: f.respuestas,
      marketing: f.marketing,
      condiciones: f.condiciones,
      solicitud,
      espera_token: inicial.espera ?? null,
    });
    setCargando(false);
    if (j.error) {
      if (["SIN_DISPONIBILIDAD", "HORA_FUERA_DE_TURNO", "ANTELACION_INSUFICIENTE"].includes(j.error)) {
        // Solicitud de grupo sin cupo: no hay otra hora que elegir, hay que hablarlo por teléfono.
        if (solicitud) {
          setError("");
          setAvisoGrupo(true);
          return;
        }
        // Volvemos a las horas actualizadas y explicamos por qué (el aviso sobrevive a buscar).
        const aviso = mensajeError(t.errores, j.error);
        await buscar();
        setAvisoHoras(aviso);
        return;
      }
      setError(mensajeError(t.errores, j.error));
      return;
    }
    setTicket(j);
    ir("ticket");
    if (j.requiere_pago && j.token) {
      // El paso de garantía / prepago lo sirve /reserva/<token>/pago (pieza de pagos).
      window.location.href = `/reserva/${j.token}/pago?lang=${lang}`;
    }
  }

  /* ───────── lista de espera ───────── */
  // turnoId "" = cualquier turno (o el único que haya).
  function abrirEspera(turnoId: string) {
    const unico = (disp?.turnos ?? []).length === 1 ? disp!.turnos![0].turno_id : "";
    setE((x) => ({ ...x, nombre: x.nombre || f.nombre, telefono: x.telefono || f.telefono, email: x.email || f.email, turno: turnoId || unico, hora: "" }));
    ir("espera");
  }

  async function apuntarEspera() {
    if (!e.nombre.trim()) return setError(t.errores.NOMBRE_REQUERIDO);
    if (!telefonoValido(e.prefijo, e.telefono)) return setError(t.errores.TELEFONO_INVALIDO);
    // Email obligatorio: hoy es el único canal por el que avisa la lista de espera (SMS/WhatsApp pendientes).
    if (!emailValido(e.email)) return setError(t.errores.EMAIL_INVALIDO);
    if (!local) return;
    setCargando(true);
    setError("");
    const turno = (disp?.turnos ?? []).find((tu) => tu.turno_id === e.turno);
    const j = await post<{ ok?: boolean }>("/api/publico/reservas/lista-espera-v2", {
      slug: local.slug,
      fecha,
      nombre: e.nombre.trim(),
      telefono: telefonoCompleto(e.prefijo, e.telefono),
      email: e.email.trim(),
      pax,
      notas: e.notas.trim(),
      // La hora que quiere el cliente; si solo eligió turno, el inicio del turno.
      hora: (turno && e.hora) || turno?.hora_inicio || null,
      zona_id: zona,
      idioma: lang,
    });
    setCargando(false);
    if (j.error) return setError(mensajeError(t.errores, j.error));
    ir("esperaOk");
  }

  /* ───────── derivados ───────── */
  const turnos = disp?.turnos ?? [];
  const turnosConHoras = turnos.filter((tu) => (tu.horas?.length ?? 0) > 0);
  const turnosGrupo = turnos.filter((tu) => tu.grupo_grande);
  const hayHoras = turnosConHoras.length > 0;
  const esGrupo = !hayHoras && turnosGrupo.length > 0;
  const zonas = disp?.zonas ?? [];
  const turnoEspera = turnos.find((tu) => tu.turno_id === e.turno) ?? null;
  const experiencias = catalogo?.experiencias ?? [];
  const pasoActual = vista === "inicio" ? 0 : vista === "horas" || vista === "espera" || vista === "esperaOk" ? 1 : vista === "datos" ? 2 : 3;
  const telGrupos = disp?.grupos_telefono || local?.grupos_telefono || local?.telefono || "";
  const resumen = local ? (
    <div className="resumen">
      <span>{local.nombre}</span>
      <span>{fmtFechaLarga(fecha, lang)}</span>
      {hora ? <span>{hora} h</span> : null}
      <span>{pax} {t.pers}</span>
    </div>
  ) : null;

  // Para compartir NO va el enlace de gestión (lleva el token y permitiría cancelar): solo el resumen y la dirección.
  const textoCompartir = ticket
    ? `${ticket.restaurante} · ${ticket.fecha} ${ticket.hora} h · ${ticket.pax} ${t.pers} · ${t.localizador} ${ticket.localizador}${ticket.direccion ? `\n${ticket.direccion}` : ""}`
    : "";

  const estiloAcento = useMemo(() => estiloMarca(local?.color_marca), [local?.color_marca]);

  /* ───────── render ───────── */
  return (
    <div className="rme" style={estiloAcento}>
      <div className="wrap">
        <header className="top">
          <div className="marca">
            {local?.logo_url ? <img src={local.logo_url} alt="" className="logo" /> : null}
            <span>{local ? local.nombre : t.marca}</span>
            {local ? <small>{t.marca}</small> : null}
          </div>
          <div className="idiomas" role="group" aria-label={t.idiomaAria}>
            {LANGS.map((l) => (
              <button key={l} type="button" lang={l} title={NOMBRE_IDIOMA[l]} className={lang === l ? "on" : ""} aria-pressed={lang === l} onClick={() => { setLang(l); setCampo("idioma", l); }}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </header>

        <ol className="pasos" aria-label={t.pasosAria}>
          {t.pasos.map((p, i) => (
            <li key={p} className={i === pasoActual ? "on" : i < pasoActual ? "hecho" : ""} aria-current={i === pasoActual ? "step" : undefined}>
              <span className="n">{i < pasoActual ? "✓" : i + 1}</span>
              <span className="l">{p}</span>
            </li>
          ))}
        </ol>

        {presc ? (
          <div className="aviso suave">
            {t.recomendadoPor} <strong>{presc.nombre}</strong>
          </div>
        ) : null}

        {/* ───────── 1 · ENCONTRAR ───────── */}
        {vista === "inicio" ? (
          <section>
            {!slugFijo ? (
              <>
                <h2 className="paso">{t.dondeReservar}</h2>
                {locales === null ? (
                  <div className="aviso info">{t.cargando}</div>
                ) : !locales.length ? (
                  <div className="aviso err">{t.errores.LOCAL_NO_DISPONIBLE}</div>
                ) : (
                  <div className="locales">
                    {locales.map((r) => (
                      <button key={r.slug} type="button" className={`local ${local?.slug === r.slug ? "sel" : ""}`} onClick={() => { setLocal(r); setZona(null); setExp(null); setDisp(null); setCatalogo(null); }}>
                        <strong>{r.nombre}</strong>
                        <span>{r.ubicacion || r.descripcion || ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : local ? (
              <p className="sub">{local.ubicacion || local.descripcion || ""}</p>
            ) : locales === null ? (
              <div className="aviso info">{t.cargando}</div>
            ) : (
              <div className="aviso err">{t.errores.LOCAL_NO_DISPONIBLE}</div>
            )}

            {local ? (
              <>
                <div className="card">
                  <label>{t.comensales}</label>
                  <div className="pax-chips" role="radiogroup" aria-label={t.comensales}>
                    {Array.from({ length: Math.min(8, Math.max(2, maxOnline)) }, (_, i) => i + 1).map((n) => (
                      <button key={n} type="button" role="radio" aria-checked={pax === n && !paxLibre} className={pax === n && !paxLibre ? "sel" : ""} onClick={() => { setPax(n); setPaxLibre(false); }}>
                        {n}
                      </button>
                    ))}
                    <button type="button" role="radio" aria-checked={paxLibre} className={paxLibre ? "sel" : ""} onClick={() => { setPaxLibre(true); if (pax <= 8) setPax(9); }}>
                      {t.mas}
                    </button>
                  </div>
                  {paxLibre ? (
                    <div className="pax">
                      <button type="button" disabled={pax <= 1} onClick={() => setPax(Math.max(1, pax - 1))} aria-label="−">−</button>
                      <input type="number" inputMode="numeric" min={1} max={200} value={pax} onChange={(ev) => setPax(Math.max(1, Math.min(200, parseInt(ev.target.value || "1", 10) || 1)))} aria-label={t.comensales} />
                      <button type="button" disabled={pax >= 200} onClick={() => setPax(Math.min(200, pax + 1))} aria-label="+">+</button>
                    </div>
                  ) : null}
                  {pax > maxOnline ? (
                    <p className="nota">{t.grupoGrande(pax, maxOnline)} {telGrupos ? <>{t.llamanos} <a href={`tel:${telGrupos.replace(/\s/g, "")}`}>{telGrupos}</a>.</> : null}</p>
                  ) : null}

                  <label>{t.dia}</label>
                  <Calendario
                    slug={local.slug}
                    valor={fecha}
                    onChange={(iso, est) => {
                      setFecha(iso);
                      setEstadoFecha(est);
                    }}
                    onEstadoValor={setEstadoFecha}
                    lang={lang}
                    min={hoy}
                    max={fechaMax}
                    pax={pax}
                  />
                  {fecha && estadoFecha === "completo" ? <p className="nota">{t.diaCompleto}</p> : null}
                </div>
                {error ? <div className="aviso err">{error}</div> : null}
                <button className="btn" disabled={!fecha || cargando} onClick={() => buscar()}>
                  {cargando ? <><span className="cargando inv" />{t.buscando}</> : t.verHoras}
                </button>
              </>
            ) : null}
            <p className="pie">{t.yaTienesReserva}</p>
          </section>
        ) : null}

        {/* ───────── 2 · HORA ───────── */}
        {vista === "horas" && local ? (
          <section>
            <button className="volver" onClick={() => ir("inicio")}>‹ {t.cambiarBusqueda}</button>
            <h2 className="paso">{t.eligeHora}</h2>
            {resumen}
            {avisoHoras ? <div className="aviso ambar" role="alert">{avisoHoras}</div> : null}

            {disp?.error ? (
              <div className="aviso err">{mensajeError(t.errores, disp.error)}</div>
            ) : disp?.cerrado ? (
              <>
                <div className="aviso info">{t.diaCerrado}</div>
                <DiasCercanos dias={cercanos} lang={lang} t={t} elegir={(d) => buscar(undefined, zona, exp, null, d)} />
                <button className="btn sec" onClick={() => ir("inicio")}>{t.probarOtroDia}</button>
              </>
            ) : (
              <>
                {zonas.length > 1 || experiencias.length ? (
                  <div className="card filtros">
                    {zonas.length > 1 ? (
                      <>
                        <label htmlFor="f-zona">{t.zona}</label>
                        <select id="f-zona" value={zona ?? ""} onChange={(ev) => cambiarZona(ev.target.value || null)} disabled={cargando}>
                          <option value="">{t.cualquierZona}</option>
                          {zonas.map((z) => (
                            <option key={z.id} value={z.id}>{z.nombre}</option>
                          ))}
                        </select>
                      </>
                    ) : null}
                    {experiencias.length ? (
                      <>
                        <label>{t.experiencia}</label>
                        <div className="exps" role="radiogroup">
                          <button type="button" role="radio" aria-checked={!exp} className={`exp ${!exp ? "sel" : ""}`} onClick={() => cambiarExp(null)} disabled={cargando}>
                            <strong>{t.sinExperiencia}</strong>
                          </button>
                          {experiencias.map((x) => (
                            <button key={x.id} type="button" role="radio" aria-checked={exp === x.id} className={`exp ${exp === x.id ? "sel" : ""}`} onClick={() => cambiarExp(x.id)} disabled={cargando}>
                              {x.imagen_url ? <img src={x.imagen_url} alt="" /> : null}
                              <strong>{x.nombre}</strong>
                              {x.descripcion ? <span>{x.descripcion}</span> : null}
                              {x.precio_pax ? <em>{fmtImporte(x.precio_pax, lang)} / {t.porPersona}</em> : null}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {cargando ? <div className="aviso info"><span className="cargando" />{t.buscando}</div> : null}

                {hayHoras ? (
                  <>
                    {turnos.map((tu) => (
                      <BloqueTurno key={tu.turno_id} tu={tu} hora={hora} setHora={setHora} t={t} onEspera={() => abrirEspera(tu.turno_id)} />
                    ))}
                    {tipoPago === "garantia" && importe ? <div className="aviso suave">{t.garantiaInfo(fmtImporte(importe, lang))} {t.politicaInfo(disp?.politica_cancelacion_horas ?? local.politica_cancelacion_horas)}</div> : null}
                    {tipoPago === "prepago" && importe ? <div className="aviso suave">{t.prepagoInfo(fmtImporte(importe, lang))}</div> : null}
                    {disp?.mensaje ? <p className="nota">{disp.mensaje}</p> : null}
                    <button className="btn" disabled={!hora} onClick={() => ir("datos")}>{t.continuar}</button>
                  </>
                ) : esGrupo ? (
                  <div className="card">
                    <p className="texto">{t.grupoGrande(pax, turnosGrupo[0].max_pax_online ?? maxOnline)}</p>
                    {telGrupos ? (
                      <a className="btn sec" href={`tel:${telGrupos.replace(/\s/g, "")}`}>{t.llamanos} {telGrupos}</a>
                    ) : null}
                    <label htmlFor="f-hgrupo">{t.horaPreferida}</label>
                    <select id="f-hgrupo" value={horaGrupo} onChange={(ev) => setHoraGrupo(ev.target.value)}>
                      <option value="">—</option>
                      {turnosGrupo.map((tu) => (
                        <optgroup key={tu.turno_id} label={tu.turno}>
                          {(tu.horas_solicitud ?? []).map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <p className="nota">{t.solicitudInfo}</p>
                    <button className="btn" disabled={!horaGrupo} onClick={() => { setHora(horaGrupo); setSolicitud(true); ir("datos"); }}>{t.solicitarGrupo}</button>
                  </div>
                ) : !cargando ? (
                  <>
                    {turnos.map((tu) => (
                      <BloqueTurno key={tu.turno_id} tu={tu} hora={hora} setHora={setHora} t={t} onEspera={() => abrirEspera(tu.turno_id)} />
                    ))}
                    <div className="aviso info">{t.sinHueco}</div>
                    <DiasCercanos dias={cercanos} lang={lang} t={t} elegir={(d) => buscar(undefined, zona, exp, null, d)} />
                    {cross === null && !slugFijo ? (
                      <div className="aviso info"><span className="cargando" />{t.buscandoOtros}</div>
                    ) : cross?.length ? (
                      <>
                        <p className="sub">{t.siHayEn}</p>
                        <div className="locales">
                          {cross.map((o) => (
                            <button key={o.local.slug} type="button" className="local" onClick={() => { setZona(null); setExp(null); setCatalogo(null); buscar(o.local, null, null); }}>
                              <strong>{o.local.nombre}</strong>
                              <span>{o.local.ubicacion || ""} · {t.horasDisponibles(o.n)}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    <button className="btn" onClick={() => abrirEspera("")}>{t.listaEspera}</button>
                    <button className="btn sec" onClick={() => ir("inicio")}>{t.probarOtroDia}</button>
                  </>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {/* ───────── LISTA DE ESPERA ───────── */}
        {vista === "espera" && local ? (
          <section>
            <button className="volver" onClick={() => ir("horas")}>‹ {t.volver}</button>
            <h2 className="paso">{t.listaEsperaTitulo}</h2>
            <p className="sub">{t.listaEsperaSub}</p>
            {resumen}
            <div className="card">
              <label htmlFor="e-nombre">{t.nombre}</label>
              <input id="e-nombre" autoComplete="name" value={e.nombre} onChange={(ev) => setCampoE("nombre", ev.target.value)} />
              <label htmlFor="e-tel">{t.telefono}</label>
              <div className="tel">
                <select aria-label={t.prefijo} value={e.prefijo} onChange={(ev) => setCampoE("prefijo", ev.target.value)}>
                  {PREFIJOS.map((p) => (
                    <option key={p.codigo + p.pais} value={p.codigo}>+{p.codigo} {p.pais}</option>
                  ))}
                </select>
                <input id="e-tel" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="600 000 000" value={e.telefono} onChange={(ev) => setCampoE("telefono", ev.target.value)} />
              </div>
              <label htmlFor="e-email">{t.email}</label>
              <input id="e-email" type="email" inputMode="email" autoComplete="email" required value={e.email} onChange={(ev) => setCampoE("email", ev.target.value)} />
              {turnos.length > 1 ? (
                <>
                  <label htmlFor="e-turno">{t.turnoPreferido}</label>
                  <select id="e-turno" value={e.turno} onChange={(ev) => setE((x) => ({ ...x, turno: ev.target.value, hora: "" }))}>
                    <option value="">{t.cualquierTurno}</option>
                    {turnos.map((tu) => (
                      <option key={tu.turno_id} value={tu.turno_id}>{tu.turno}</option>
                    ))}
                  </select>
                </>
              ) : null}
              {turnoEspera?.hora_inicio && turnoEspera.hora_fin ? (
                <>
                  <label htmlFor="e-hora">{t.horaPreferida}</label>
                  <select id="e-hora" value={e.hora} onChange={(ev) => setCampoE("hora", ev.target.value)}>
                    <option value="">{t.cualquierHora}</option>
                    {horasEntre(turnoEspera.hora_inicio, turnoEspera.hora_fin, Math.max(15, turnoEspera.intervalo_min ?? 15)).map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </>
              ) : null}
              <label htmlFor="e-notas">{t.comentario}</label>
              <textarea id="e-notas" placeholder={t.comentarioPh} value={e.notas} onChange={(ev) => setCampoE("notas", ev.target.value)} />
            </div>
            {error ? <div className="aviso err">{error}</div> : null}
            <button className="btn" disabled={cargando} onClick={apuntarEspera}>{t.apuntarme}</button>
          </section>
        ) : null}

        {vista === "esperaOk" && local ? (
          <section>
            <h2 className="paso">{t.apuntado} ✓</h2>
            <div className="aviso ok">{t.apuntadoMsg(local.nombre, fmtFechaLarga(fecha, lang), pax)}</div>
            <button className="btn sec" onClick={() => window.location.reload()}>{t.volverInicio}</button>
          </section>
        ) : null}

        {/* ───────── 3 · DATOS ───────── */}
        {vista === "datos" && local ? (
          <section>
            <button className="volver" onClick={() => ir("horas")}>‹ {t.cambiarHora}</button>
            <h2 className="paso">{t.tusDatos}</h2>
            {resumen}
            {solicitud ? <div className="aviso suave">{t.solicitudInfo}</div> : null}
            <form
              className="card"
              onSubmit={(ev) => {
                ev.preventDefault();
                crear();
              }}
              noValidate
            >
              <div className="dos">
                <div>
                  <label htmlFor="d-nombre">{t.nombre}</label>
                  <input id="d-nombre" autoComplete="given-name" required value={f.nombre} onChange={(ev) => setCampo("nombre", ev.target.value)} />
                </div>
                <div>
                  <label htmlFor="d-apellidos">{t.apellidos}</label>
                  <input id="d-apellidos" autoComplete="family-name" value={f.apellidos} onChange={(ev) => setCampo("apellidos", ev.target.value)} />
                </div>
              </div>
              <label htmlFor="d-tel">{t.telefono}</label>
              <div className="tel">
                <select aria-label={t.prefijo} value={f.prefijo} onChange={(ev) => setCampo("prefijo", ev.target.value)}>
                  {PREFIJOS.map((p) => (
                    <option key={p.codigo + p.pais} value={p.codigo}>+{p.codigo} {p.pais}</option>
                  ))}
                </select>
                <input id="d-tel" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="600 000 000" required value={f.telefono} onChange={(ev) => setCampo("telefono", ev.target.value)} />
              </div>
              <label htmlFor="d-email">{t.email}</label>
              <input id="d-email" type="email" inputMode="email" autoComplete="email" required value={f.email} onChange={(ev) => setCampo("email", ev.target.value)} />
              <label htmlFor="d-idioma">{t.idioma}</label>
              <select id="d-idioma" value={f.idioma} onChange={(ev) => setCampo("idioma", ev.target.value)}>
                {LANGS.map((i) => (
                  <option key={i} value={i}>{NOMBRE_IDIOMA[i]}</option>
                ))}
              </select>

              <label>{t.alergias}</label>
              <div className="sino" role="radiogroup">
                <button type="button" role="radio" aria-checked={!f.alergiasSi} className={!f.alergiasSi ? "sel" : ""} onClick={() => setCampo("alergiasSi", false)}>{t.no}</button>
                <button type="button" role="radio" aria-checked={f.alergiasSi} className={f.alergiasSi ? "sel" : ""} onClick={() => setCampo("alergiasSi", true)}>{t.si}</button>
              </div>
              {f.alergiasSi ? <input aria-label={t.alergias} placeholder={t.alergiasPh} value={f.alergias} onChange={(ev) => setCampo("alergias", ev.target.value)} /> : null}

              <label htmlFor="d-com">{t.comentario}</label>
              <textarea id="d-com" placeholder={t.comentarioPh} value={f.comentario} onChange={(ev) => setCampo("comentario", ev.target.value)} />

              {preguntas.map((p) => (
                <PreguntaCampo key={p.id} p={p} lang={lang} t={t} valor={f.respuestas[p.id]} onChange={(v) => setCampo("respuestas", { ...f.respuestas, [p.id]: v })} />
              ))}

              {f.verCodigo ? (
                <>
                  <label htmlFor="d-codigo">{t.codigo}</label>
                  <input id="d-codigo" className="mono" autoCapitalize="characters" value={f.codigo} onChange={(ev) => setCampo("codigo", ev.target.value.toUpperCase())} />
                </>
              ) : (
                <button type="button" className="enlace" onClick={() => setCampo("verCodigo", true)}>{t.codigoPromo}</button>
              )}

              <label className="check">
                <input type="checkbox" checked={f.marketing} onChange={(ev) => setCampo("marketing", ev.target.checked)} />
                <span>{t.marketing}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={f.condiciones} onChange={(ev) => setCampo("condiciones", ev.target.checked)} required />
                <span>
                  {t.condiciones}{" "}
                  <a href={local.url_condiciones || `/reservar-mesa/privacidad?lang=${lang}`} target="_blank" rel="noopener noreferrer">{t.condicionesLink}</a>.
                </span>
              </label>
              <p className="rgpd">
                {t.rgpdInfo}{" "}
                <a href={`/reservar-mesa/privacidad?lang=${lang}`} target="_blank" rel="noopener noreferrer">{t.rgpdLink}</a>.
              </p>

              {tipoPago === "garantia" && importe && !solicitud ? <div className="aviso suave">{t.garantiaInfo(fmtImporte(importe, lang))}</div> : null}
              {tipoPago === "prepago" && importe && !solicitud ? <div className="aviso suave">{t.prepagoInfo(fmtImporte(importe, lang))}</div> : null}
              {error ? <div className="aviso err">{error}</div> : null}
              {avisoGrupo ? (
                <div className="aviso ambar" role="alert">
                  {t.grupoSinCupo} {telGrupos ? <>{t.llamanos} <a href={`tel:${telGrupos.replace(/\s/g, "")}`}>{telGrupos}</a>.</> : null}
                </div>
              ) : null}
              <button className="btn" type="submit" disabled={cargando || avisoGrupo}>
                {cargando ? t.reservando : solicitud ? t.enviarSolicitud : tipoPago ? t.continuarPago : t.confirmarReserva}
              </button>
            </form>
          </section>
        ) : null}

        {/* ───────── 4 · CONFIRMACIÓN ───────── */}
        {vista === "ticket" && ticket ? (
          <section>
            {ticket.requiere_pago ? (
              <div className="aviso info">
                <span className="cargando" />{t.redirigiendoPago}{" "}
                <a href={`/reserva/${ticket.token}/pago?lang=${lang}`}>{t.irAlPago}</a>
              </div>
            ) : null}
            <div className="ticket">
              <div className="cab">
                <div className="t">{ticket.restaurante}</div>
                <div className="s">{ticket.solicitud ? t.solicitudRecibida : ticket.estado === "confirmada" ? t.reservaConfirmada : t.reservaRecibida}</div>
              </div>
              <div className="cuerpo">
                <div className="loc-label">{t.localizador}</div>
                <div className="loc">{ticket.localizador}</div>
                {ticket.solicitud || ticket.estado === "pendiente" ? <p className="nota centrado">{t.pendienteRestaurante}</p> : null}
                <div className="perfo" />
                <dl>
                  <div><dt>{t.dia}</dt><dd>{fmtFechaLarga(isoDesdeDdmm(ticket.fecha), lang)}</dd></div>
                  <div><dt>{t.hora}</dt><dd>{ticket.hora} h</dd></div>
                  <div><dt>{t.comensales}</dt><dd>{ticket.pax}</dd></div>
                  <div><dt>{t.aNombreDe}</dt><dd>{[f.nombre, f.apellidos].filter(Boolean).join(" ").trim()}</dd></div>
                </dl>
                {ticket.mensaje ? <p className="nota centrado">{ticket.mensaje}</p> : null}
                <div className="acciones-ticket">
                  {ticket.ics ? <a href={ticket.ics} download>{t.anadirCalendario}</a> : null}
                  <a href={urlWhatsApp(textoCompartir)} target="_blank" rel="noopener noreferrer">{t.compartirWhatsApp}</a>
                  {ticket.direccion ? <a href={urlMapa(ticket.direccion)} target="_blank" rel="noopener noreferrer">{t.comoLlegar}</a> : null}
                  {ticket.token ? <a href={`/reserva/${ticket.token}?lang=${lang}`}>{t.gestionarReserva}</a> : null}
                </div>
              </div>
            </div>
            <p className="sub centrado">{t.guardaEnlace}</p>
            {ticket.token && !ticket.requiere_pago && ticket.pax > 1 ? <Invitar token={ticket.token} pax={ticket.pax} lang={lang} /> : null}
            <button className="btn sec" onClick={() => window.location.reload()}>{t.otraReserva}</button>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/* ───────── bloques auxiliares ───────── */

type T = ReturnType<typeof textos>;

/** Texto de una pregunta personalizada: la versión inglesa para en/fr/de si existe. */
function textoPregunta(p: Pregunta, lang: Lang): string {
  return lang !== "es" && lang !== "ca" && p.texto_en ? p.texto_en : p.texto;
}

/** Chips con los próximos días con hueco (sale cuando el día elegido no tiene). */
function DiasCercanos({ dias, lang, t, elegir }: { dias: string[]; lang: Lang; t: T; elegir: (iso: string) => void }) {
  if (!dias.length) return null;
  return (
    <>
      <p className="sub">{t.diasCercanos}</p>
      <div className="chips dias-cerca">
        {dias.map((d) => (
          <button key={d} type="button" onClick={() => elegir(d)}>
            {new Date(d + "T12:00:00").toLocaleDateString(locale(lang), { weekday: "short", day: "numeric", month: "short" })}
          </button>
        ))}
      </div>
    </>
  );
}

function BloqueTurno({ tu, hora, setHora, t, onEspera }: { tu: TurnoV2; hora: string | null; setHora: (h: string) => void; t: T; onEspera: () => void }) {
  // Turno lleno (o sin horas online) que no está cerrado ni es tema de grupo: lista de espera de ese turno.
  const lleno = !tu.cerrado && !tu.grupo_grande && (tu.completo || !tu.horas?.length);
  return (
    <div className="turno-bloque">
      <div className="turno-cab">
        <span className="turno-nombre">{tu.turno}</span>
        {tu.cerrado ? <span className="turno-etq">{t.turnoCerrado}{tu.nota ? ` · ${tu.nota}` : ""}</span> : null}
        {tu.completo ? <span className="turno-etq">{t.turnoCompleto}</span> : null}
        {tu.grupo_grande ? <span className="turno-etq">{t.llamanos}</span> : null}
      </div>
      {tu.horas?.length ? (
        <div className="horas">
          {tu.horas.map((h) => (
            <button key={h.hora} type="button" className={`hora-chip ${hora === h.hora ? "sel" : ""} ${h.pocas ? "pocas" : ""}`} onClick={() => setHora(h.hora)} aria-pressed={hora === h.hora}>
              {h.hora}
              {h.pocas ? <small>{t.pocasPlazas}</small> : null}
            </button>
          ))}
        </div>
      ) : !tu.cerrado && !tu.completo && !tu.grupo_grande ? (
        <div className="turno-vacio">{t.turnoCompleto}</div>
      ) : null}
      {lleno ? (
        <button type="button" className="enlace" onClick={onEspera}>{t.esperaTurno}</button>
      ) : null}
    </div>
  );
}

function PreguntaCampo({ p, lang, t, valor, onChange }: { p: Pregunta; lang: Lang; t: T; valor: Respuesta | undefined; onChange: (v: Respuesta) => void }) {
  const texto = textoPregunta(p, lang);
  const id = `q-${p.id}`;
  if (p.tipo === "si_no") {
    return (
      <>
        <label>{texto}{p.obligatoria ? " *" : ""}</label>
        <div className="sino" role="radiogroup">
          <button type="button" role="radio" aria-checked={valor === false} className={valor === false ? "sel" : ""} onClick={() => onChange(false)}>{t.no}</button>
          <button type="button" role="radio" aria-checked={valor === true} className={valor === true ? "sel" : ""} onClick={() => onChange(true)}>{t.si}</button>
        </div>
      </>
    );
  }
  if (p.tipo === "desplegable") {
    return (
      <>
        <label htmlFor={id}>{texto}{p.obligatoria ? " *" : ""}</label>
        <select id={id} value={typeof valor === "string" ? valor : ""} onChange={(ev) => onChange(ev.target.value)}>
          <option value="">—</option>
          {(p.opciones ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </>
    );
  }
  if (p.tipo === "multiple") {
    const sel = Array.isArray(valor) ? valor : [];
    return (
      <>
        <label>{texto}{p.obligatoria ? " *" : ""}</label>
        <div className="chips">
          {(p.opciones ?? []).map((o) => (
            <button key={o} type="button" className={sel.includes(o) ? "sel" : ""} aria-pressed={sel.includes(o)} onClick={() => onChange(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o])}>
              {o}
            </button>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <label htmlFor={id}>{texto}{p.obligatoria ? " *" : ""}</label>
      <input id={id} value={typeof valor === "string" ? valor : ""} onChange={(ev) => onChange(ev.target.value)} />
    </>
  );
}
