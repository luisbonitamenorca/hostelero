"use client";

import { useEffect, useState } from "react";

type Local = {
  slug: string;
  nombre: string;
  ubicacion: string | null;
  descripcion: string | null;
  telefono: string | null;
  antelacion_max_dias: number;
  online_activo: boolean;
};
type TurnoDisp = { turno: string; horas?: string[]; grupo_grande?: boolean };
type Disp = { error?: string; cerrado?: boolean; turnos?: TurnoDisp[] };
type Ticket = { restaurante: string; localizador: string; fecha: string; hora: string; pax: number };

const MSG: Record<string, string> = {
  LOCAL_NO_DISPONIBLE: "Este restaurante no admite reservas online ahora mismo. Llámanos y te atendemos.",
  TELEFONO_INVALIDO: "Revisa el teléfono: necesitamos al menos 9 dígitos.",
  NOMBRE_REQUERIDO: "Dinos tu nombre para completar la reserva.",
  PAX_INVALIDO: "El número de comensales no es válido.",
  FECHA_FUERA_DE_RANGO: "Esa fecha queda fuera del calendario de reservas online.",
  HORA_FUERA_DE_TURNO: "Esa hora ya no está disponible. Elige otra.",
  GRUPO_GRANDE: "Para grupos grandes, llámanos y lo organizamos contigo.",
  ANTELACION_INSUFICIENTE: "Esa hora está demasiado cerca. Elige otra o llámanos.",
  SIN_DISPONIBILIDAD: "Justo se ha ocupado esa hora. Elige otra, por favor.",
  NO_ENCONTRADA: "No encontramos ninguna reserva con esos datos.",
  NO_CANCELABLE: "Esta reserva ya no se puede cancelar online. Llámanos y lo vemos.",
  RED: "No hay conexión. Comprueba tu red e inténtalo de nuevo.",
};
const ESTADOS: Record<string, string> = {
  pendiente: "Recibida",
  confirmada: "Confirmada",
  sentada: "En mesa",
  terminada: "Completada",
  no_show: "No presentado",
  cancelada: "Cancelada",
};

const hoyISO = () => new Date().toISOString().slice(0, 10);
const fmtFecha = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

type Vista = "locales" | "fecha" | "horas" | "espera" | "esperaOk" | "datos" | "ticket" | "gestion";

export default function ReservarMesaApp() {
  const [vista, setVista] = useState<Vista>("locales");
  const [locales, setLocales] = useState<Local[] | null>(null);
  const [local, setLocal] = useState<Local | null>(null);
  const [fecha, setFecha] = useState(hoyISO());
  const [pax, setPax] = useState(2);
  const [hora, setHora] = useState<string | null>(null);
  const [disp, setDisp] = useState<Disp | null>(null);
  const [cross, setCross] = useState<{ local: Local; n: number }[] | null>(null);
  const [cargandoBtn, setCargandoBtn] = useState(false);
  const [ticket, setTicket] = useState<(Ticket & { nombre: string }) | null>(null);

  // datos
  const [dNombre, setDNombre] = useState("");
  const [dTel, setDTel] = useState("");
  const [dEmail, setDEmail] = useState("");
  const [dNotas, setDNotas] = useState("");
  const [dError, setDError] = useState("");
  // espera
  const [eNombre, setENombre] = useState("");
  const [eTel, setETel] = useState("");
  const [eNotas, setENotas] = useState("");
  const [eError, setEError] = useState("");
  // gestión
  const [gLoc, setGLoc] = useState("");
  const [gTel, setGTel] = useState("");
  const [gError, setGError] = useState("");
  const [gOk, setGOk] = useState("");
  const [gRes, setGRes] = useState<{ restaurante: string; estado: string; fecha: string; hora: string; pax: number } | null>(null);

  useEffect(() => {
    fetch("/api/publico/reservas/restaurantes")
      .then((r) => r.json())
      .then((j) => setLocales(j.restaurantes ?? []))
      .catch(() => setLocales([]));
  }, []);

  function ir(v: Vista) {
    setVista(v);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  function elegirLocal(r: Local) {
    setLocal(r);
    const min = hoyISO();
    if (!fecha || fecha < min) setFecha(min);
    ir("fecha");
  }

  async function buscarDisponibilidad(l?: Local) {
    const loc = l ?? local;
    if (!loc || !fecha) return;
    if (l) setLocal(l);
    setCargandoBtn(true);
    setHora(null);
    setCross(null);
    try {
      const r = await fetch(`/api/publico/reservas/disponibilidad?slug=${encodeURIComponent(loc.slug)}&fecha=${fecha}&pax=${pax}`);
      const j: Disp = await r.json();
      setDisp(j);
      ir("horas");
      // Cross-selling si no hay horas
      const horas = (j.turnos ?? []).flatMap((t) => t.horas ?? []);
      const grupoGrande = (j.turnos ?? []).some((t) => t.grupo_grande);
      if (!j.error && !j.cerrado && !horas.length && !grupoGrande) {
        const otros = (locales ?? []).filter((x) => x.slug !== loc.slug && x.online_activo);
        const conMesa: { local: Local; n: number }[] = [];
        await Promise.all(
          otros.map(async (o) => {
            try {
              const rr = await fetch(`/api/publico/reservas/disponibilidad?slug=${encodeURIComponent(o.slug)}&fecha=${fecha}&pax=${pax}`);
              const jj: Disp = await rr.json();
              if (!jj.error && !jj.cerrado) {
                const hs = (jj.turnos ?? []).flatMap((t) => t.horas ?? []);
                if (hs.length) conMesa.push({ local: o, n: hs.length });
              }
            } catch { /* silencioso */ }
          }),
        );
        setCross(conMesa);
      }
    } catch {
      alert(MSG.RED);
    } finally {
      setCargandoBtn(false);
    }
  }

  async function crearReserva() {
    setDError("");
    if (!dNombre.trim()) return setDError(MSG.NOMBRE_REQUERIDO);
    if (dTel.replace(/\D/g, "").length < 9) return setDError(MSG.TELEFONO_INVALIDO);
    if (!local || !hora) return;
    setCargandoBtn(true);
    try {
      const r = await fetch("/api/publico/reservas/crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: local.slug, fecha, hora, pax,
          nombre: dNombre.trim(), telefono: dTel.trim(), email: dEmail.trim(), notas: dNotas.trim(),
        }),
      });
      const j = await r.json();
      if (j.error) {
        setDError(MSG[j.error] || j.error);
        if (["SIN_DISPONIBILIDAD", "HORA_FUERA_DE_TURNO", "ANTELACION_INSUFICIENTE"].includes(j.error)) {
          setTimeout(() => buscarDisponibilidad(), 1600);
        }
        return;
      }
      setTicket({ ...(j as Ticket), nombre: dNombre.trim() });
      ir("ticket");
    } catch {
      setDError(MSG.RED);
    } finally {
      setCargandoBtn(false);
    }
  }

  async function apuntarEspera() {
    setEError("");
    if (!eNombre.trim()) return setEError(MSG.NOMBRE_REQUERIDO);
    if (eTel.replace(/\D/g, "").length < 9) return setEError(MSG.TELEFONO_INVALIDO);
    if (!local) return;
    setCargandoBtn(true);
    try {
      const r = await fetch("/api/publico/reservas/lista-espera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: local.slug, fecha, nombre: eNombre.trim(), telefono: eTel.trim(), pax, notas: eNotas.trim() }),
      });
      const j = await r.json();
      if (j.error) { setEError(MSG[j.error] || j.error); return; }
      ir("esperaOk");
    } catch {
      setEError(MSG.RED);
    } finally {
      setCargandoBtn(false);
    }
  }

  async function consultar() {
    setGError(""); setGOk(""); setGRes(null);
    if (!gLoc.trim() || gTel.replace(/\D/g, "").length < 9) {
      setGError("Introduce el localizador y tu teléfono.");
      return;
    }
    setCargandoBtn(true);
    try {
      const r = await fetch(`/api/publico/reservas/consultar?localizador=${encodeURIComponent(gLoc.trim())}&telefono=${encodeURIComponent(gTel.trim())}`);
      const j = await r.json();
      if (j.error) { setGError(MSG[j.error] || j.error); return; }
      setGRes(j);
    } catch {
      setGError(MSG.RED);
    } finally {
      setCargandoBtn(false);
    }
  }

  async function cancelar() {
    if (!confirm("¿Seguro que quieres cancelar esta reserva?")) return;
    setCargandoBtn(true);
    try {
      const r = await fetch("/api/publico/reservas/cancelar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localizador: gLoc.trim(), telefono: gTel.trim() }),
      });
      const j = await r.json();
      if (j.error) { setGError(MSG[j.error] || j.error); return; }
      setGRes(gRes ? { ...gRes, estado: "cancelada" } : gRes);
      setGOk("Reserva cancelada. ¡Te esperamos en otra ocasión!");
    } catch {
      setGError(MSG.RED);
    } finally {
      setCargandoBtn(false);
    }
  }

  const calLink = ticket
    ? (() => {
        const [dd, mm, aa] = ticket.fecha.split("/");
        const [hh, mi] = ticket.hora.split(":");
        const ini = `${aa}${mm}${dd}T${hh}${mi}00`;
        const finH = String((parseInt(hh) + 2) % 24).padStart(2, "0");
        return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("Reserva " + ticket.restaurante)}&dates=${ini}/${finH === "00" ? ini : `${aa}${mm}${dd}T${finH}${mi}00`}&details=${encodeURIComponent("Localizador " + ticket.localizador + " · " + ticket.pax + " pax")}`;
      })()
    : "";

  const horasDisponibles = (disp?.turnos ?? []).filter((t) => !t.grupo_grande && t.horas?.length);
  const grupoGrande = (disp?.turnos ?? []).some((t) => t.grupo_grande) && !horasDisponibles.length;

  return (
    <div className="rme">
      <div className="wrap">
        <header className="top">
          <div className="marca">Bonita Menorca<small>Reservas</small></div>
          <svg className="ola" viewBox="0 0 64 10" fill="none" aria-hidden="true">
            <path d="M1 5 Q9 0 17 5 T33 5 T49 5 T65 5" stroke="#0F4C5C" strokeWidth="1.6" strokeLinecap="round" opacity=".6" />
          </svg>
        </header>

        {vista === "locales" ? (
          <section>
            <h2 className="paso">¿Dónde quieres reservar?</h2>
            <p className="sub">Elige uno de nuestros restaurantes.</p>
            {locales === null ? (
              <div className="aviso info">Cargando restaurantes…</div>
            ) : !locales.length ? (
              <div className="aviso err">{MSG.RED}</div>
            ) : (
              locales.map((r) => (
                <div key={r.slug} className="card rest" role="button" tabIndex={0}
                  onClick={() => elegirLocal(r)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegirLocal(r); } }}>
                  <div>
                    <h3>{r.nombre}</h3>
                    <p>{r.ubicacion || ""}{r.descripcion ? ` · ${r.descripcion}` : ""}</p>
                  </div>
                  <span className="flecha">›</span>
                </div>
              ))
            )}
            <div className="pie">
              ¿Ya tienes una reserva?
              <button className="enlace" onClick={() => ir("gestion")}>Consultar o cancelar con tu localizador</button>
            </div>
          </section>
        ) : null}

        {vista === "fecha" && local ? (
          <section>
            <button className="volver" onClick={() => ir("locales")}>‹ Cambiar restaurante</button>
            <h2 className="paso">{local.nombre}</h2>
            <p className="sub">{local.ubicacion || ""}</p>
            <div className="card">
              <label htmlFor="f-fecha">Día</label>
              <input
                type="date" id="f-fecha" value={fecha}
                min={hoyISO()}
                max={(() => { const d = new Date(); d.setDate(d.getDate() + (local.antelacion_max_dias || 60)); return d.toISOString().slice(0, 10); })()}
                onChange={(e) => setFecha(e.target.value)}
              />
              <label>Comensales</label>
              <div className="pax">
                <button type="button" disabled={pax <= 1} onClick={() => setPax(Math.max(1, pax - 1))} aria-label="Menos comensales">−</button>
                <span>{pax}</span>
                <button type="button" disabled={pax >= 20} onClick={() => setPax(Math.min(20, pax + 1))} aria-label="Más comensales">+</button>
              </div>
            </div>
            <button className="btn" disabled={cargandoBtn} onClick={() => buscarDisponibilidad()}>
              {cargandoBtn ? <><span className="cargando" style={{ borderColor: "rgba(255,255,255,.4)", borderTopColor: "#fff" }} />Buscando mesas…</> : "Ver horas disponibles"}
            </button>
          </section>
        ) : null}

        {vista === "horas" && local ? (
          <section>
            <button className="volver" onClick={() => ir("fecha")}>‹ Cambiar día o comensales</button>
            <h2 className="paso">Elige la hora</h2>
            <div className="resumen">
              <span>{local.nombre}</span><span>{fmtFecha(fecha)}</span><span>{pax} pax</span>
            </div>
            {disp?.error ? (
              <div className="aviso err">{MSG[disp.error] || disp.error}</div>
            ) : disp?.cerrado ? (
              <div className="aviso info">Ese día el restaurante está cerrado. Prueba otra fecha.</div>
            ) : grupoGrande ? (
              <div className="aviso info">
                Para {pax} personas preferimos organizarlo por teléfono: llámanos al <strong>{local.telefono || "restaurante"}</strong> y te buscamos el mejor sitio.
              </div>
            ) : horasDisponibles.length ? (
              <>
                {horasDisponibles.map((t) => (
                  <div key={t.turno} className="turno-bloque">
                    <div className="turno-nombre">{t.turno}</div>
                    <div className="horas">
                      {(t.horas ?? []).map((h) => (
                        <button key={h} type="button" className={`hora-chip ${hora === h ? "sel" : ""}`} onClick={() => setHora(h)}>
                          {h}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {hora ? <button className="btn" onClick={() => { setDError(""); ir("datos"); }}>Continuar</button> : null}
              </>
            ) : (
              <>
                <div className="aviso info">No queda mesa online en {local.nombre} para ese día y ese número de comensales.</div>
                {cross === null ? (
                  <div className="aviso info"><span className="cargando" />Buscando mesa en el resto de restaurantes del grupo…</div>
                ) : cross.length ? (
                  <>
                    <p className="sub" style={{ margin: "14px 0 8px" }}>Ese mismo día sí tenemos mesa en:</p>
                    {cross.map((o) => (
                      <div key={o.local.slug} className="card rest" role="button" tabIndex={0} onClick={() => buscarDisponibilidad(o.local)}>
                        <div>
                          <h3>{o.local.nombre}</h3>
                          <p>{o.local.ubicacion || ""} · {o.n} hora{o.n > 1 ? "s" : ""} disponible{o.n > 1 ? "s" : ""}</p>
                        </div>
                        <span className="flecha">›</span>
                      </div>
                    ))}
                  </>
                ) : null}
                <button className="btn vino" onClick={() => { setEError(""); ir("espera"); }}>Apuntarme a la lista de espera</button>
                <button className="btn sec" onClick={() => ir("fecha")}>Probar otro día</button>
              </>
            )}
          </section>
        ) : null}

        {vista === "espera" && local ? (
          <section>
            <button className="volver" onClick={() => ir("horas")}>‹ Volver</button>
            <h2 className="paso">Apúntate a la lista de espera</h2>
            <p className="sub">Si queda una mesa libre ese día, te llamaremos.</p>
            <div className="card">
              <label htmlFor="e-nombre">Nombre</label>
              <input id="e-nombre" autoComplete="name" value={eNombre} onChange={(e) => setENombre(e.target.value)} />
              <label htmlFor="e-tel">Teléfono</label>
              <input id="e-tel" type="tel" inputMode="tel" autoComplete="tel" placeholder="600 000 000" value={eTel} onChange={(e) => setETel(e.target.value)} />
              <label htmlFor="e-notas">Comentarios (opcional)</label>
              <textarea id="e-notas" placeholder="Franja horaria preferida, carrito de bebé…" value={eNotas} onChange={(e) => setENotas(e.target.value)} />
            </div>
            {eError ? <div className="aviso err">{eError}</div> : null}
            <button className="btn vino" disabled={cargandoBtn} onClick={apuntarEspera}>Apuntarme</button>
          </section>
        ) : null}

        {vista === "esperaOk" && local ? (
          <section>
            <h2 className="paso">Apuntado ✓</h2>
            <div className="aviso ok">
              Estás en la lista de espera de {local.nombre} para el {fmtFecha(fecha)} ({pax} pax). Si se libera una mesa, te llamaremos al {eTel}.
            </div>
            <button className="btn sec" onClick={() => window.location.reload()}>Volver al inicio</button>
          </section>
        ) : null}

        {vista === "datos" && local ? (
          <section>
            <button className="volver" onClick={() => ir("horas")}>‹ Cambiar hora</button>
            <h2 className="paso">Tus datos</h2>
            <div className="resumen">
              <span>{local.nombre}</span><span>{fmtFecha(fecha)}</span><span>{hora} h</span><span>{pax} pax</span>
            </div>
            <div className="card">
              <label htmlFor="d-nombre">Nombre y apellido</label>
              <input id="d-nombre" autoComplete="name" value={dNombre} onChange={(e) => setDNombre(e.target.value)} />
              <label htmlFor="d-tel">Teléfono móvil</label>
              <input id="d-tel" type="tel" inputMode="tel" autoComplete="tel" placeholder="600 000 000" value={dTel} onChange={(e) => setDTel(e.target.value)} />
              <label htmlFor="d-email">Email (opcional)</label>
              <input id="d-email" type="email" autoComplete="email" placeholder="tu@email.com" value={dEmail} onChange={(e) => setDEmail(e.target.value)} />
              <label htmlFor="d-notas">Alergias o peticiones (opcional)</label>
              <textarea id="d-notas" placeholder="Alergias, trona, celebración…" value={dNotas} onChange={(e) => setDNotas(e.target.value)} />
            </div>
            {dError ? <div className="aviso err">{dError}</div> : null}
            <button className="btn" disabled={cargandoBtn} onClick={crearReserva}>
              {cargandoBtn ? "Reservando…" : "Confirmar reserva"}
            </button>
          </section>
        ) : null}

        {vista === "ticket" && ticket ? (
          <section>
            <div className="ticket">
              <div className="cab">
                <div className="t">{ticket.restaurante}</div>
                <div className="s">Reserva recibida</div>
              </div>
              <div className="cuerpo">
                <div className="loc-label">Localizador</div>
                <div className="loc">{ticket.localizador}</div>
                <div className="perfo" />
                <dl>
                  <div><dt>Día</dt><dd>{ticket.fecha}</dd></div>
                  <div><dt>Hora</dt><dd>{ticket.hora} h</dd></div>
                  <div><dt>Comensales</dt><dd>{ticket.pax}</dd></div>
                  <div><dt>A nombre de</dt><dd>{ticket.nombre}</dd></div>
                </dl>
                <div className="acciones-ticket">
                  <a href={calLink} target="_blank" rel="noopener noreferrer">Añadir al calendario</a>
                  {local?.telefono ? <a href={`tel:${local.telefono.replace(/\s/g, "")}`}>Llamar al restaurante</a> : null}
                </div>
              </div>
            </div>
            <p className="sub" style={{ textAlign: "center", marginTop: 16 }}>
              Guarda tu localizador: lo necesitarás para consultar o cancelar la reserva. Si no puedes venir, cancela con antelación — otra persona ocupará tu mesa.
            </p>
            <button className="btn sec" onClick={() => window.location.reload()}>Hacer otra reserva</button>
          </section>
        ) : null}

        {vista === "gestion" ? (
          <section>
            <button className="volver" onClick={() => ir("locales")}>‹ Volver al inicio</button>
            <h2 className="paso">Tu reserva</h2>
            <p className="sub">Introduce el localizador y el teléfono con el que reservaste.</p>
            <div className="card">
              <label htmlFor="g-loc">Localizador</label>
              <input id="g-loc" style={{ fontFamily: "ui-monospace,Menlo,monospace", letterSpacing: ".12em", textTransform: "uppercase" }} maxLength={6} placeholder="A1B2C3" value={gLoc} onChange={(e) => setGLoc(e.target.value)} />
              <label htmlFor="g-tel">Teléfono</label>
              <input id="g-tel" type="tel" inputMode="tel" placeholder="600 000 000" value={gTel} onChange={(e) => setGTel(e.target.value)} />
            </div>
            {gError ? <div className="aviso err">{gError}</div> : null}
            {gOk ? <div className="aviso ok">{gOk}</div> : null}
            <button className="btn" disabled={cargandoBtn} onClick={consultar}>Consultar</button>
            {gRes ? (
              <>
                <div className="card" style={{ marginTop: 18 }}>
                  <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, textAlign: "center" }}>
                    <div><dt className="loc-label">Restaurante</dt><dd style={{ fontWeight: 600, marginTop: 3 }}>{gRes.restaurante}</dd></div>
                    <div><dt className="loc-label">Estado</dt><dd style={{ fontWeight: 600, marginTop: 3 }}>{ESTADOS[gRes.estado] || gRes.estado}</dd></div>
                    <div><dt className="loc-label">Día</dt><dd style={{ fontWeight: 600, marginTop: 3 }}>{gRes.fecha}</dd></div>
                    <div><dt className="loc-label">Hora · pax</dt><dd style={{ fontWeight: 600, marginTop: 3 }}>{gRes.hora} h · {gRes.pax} pax</dd></div>
                  </dl>
                </div>
                {["pendiente", "confirmada"].includes(gRes.estado) ? (
                  <button className="btn vino" disabled={cargandoBtn} onClick={cancelar}>Cancelar esta reserva</button>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
