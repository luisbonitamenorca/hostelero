"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Prod = {
  nombre_es: string;
  nombre_en: string | null;
  nombre_fr: string | null;
  precio: number;
  duracion_min: number | null;
};
type Sesion = { id: string; fecha: string; hora: string; free: number; producto: Prod };
type Lang = "es" | "en" | "fr";

const LANGS: Lang[] = ["es", "en", "fr"];
const LOCALE: Record<Lang, string> = { es: "es-ES", en: "en-GB", fr: "fr-FR" };
const DOW: Record<Lang, string[]> = {
  es: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  fr: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
};
const T = {
  es: { title: "Reserva tu visita", sub: "Elige el día y descubre las experiencias disponibles", results: (d: string) => "Experiencias para el " + d, none: "No hay visitas disponibles este día.", left: (n: number) => "Quedan " + n + (n === 1 ? " plaza" : " plazas"), buy: "Reservar", book: "Completa tu reserva", name: "Nombre y apellidos", email: "Email", phone: "Teléfono (opcional)", country: "País", people: "Personas", total: "Total", cancel: "Cancelar", confirm: "Confirmar reserva", okT: "¡Reserva recibida!", okP1: "Hemos guardado tu plaza.", okP2: "Recibirás la confirmación por email.", code: "Código", close: "Cerrar", sending: "Enviando…", reqName: "Indica tu nombre", reqEmail: "Indica un email válido", errGen: "No se pudo completar la reserva. Inténtalo de nuevo.", mk: "Quiero recibir noticias y ofertas de Binifadet por email" },
  en: { title: "Book your visit", sub: "Choose a day and discover the available experiences", results: (d: string) => "Experiences for " + d, none: "No visits available on this day.", left: (n: number) => n + (n === 1 ? " spot left" : " spots left"), buy: "Book", book: "Complete your booking", name: "Full name", email: "Email", phone: "Phone (optional)", country: "Country", people: "People", total: "Total", cancel: "Cancel", confirm: "Confirm booking", okT: "Booking received!", okP1: "Your spot is saved.", okP2: "You will receive confirmation by email.", code: "Code", close: "Close", sending: "Sending…", reqName: "Enter your name", reqEmail: "Enter a valid email", errGen: "Could not complete the booking. Please try again.", mk: "I want to receive Binifadet news and offers by email" },
  fr: { title: "Réservez votre visite", sub: "Choisissez un jour et découvrez les expériences disponibles", results: (d: string) => "Expériences pour le " + d, none: "Aucune visite disponible ce jour.", left: (n: number) => n + (n === 1 ? " place restante" : " places restantes"), buy: "Réserver", book: "Finalisez votre réservation", name: "Nom et prénom", email: "Email", phone: "Téléphone (optionnel)", country: "Pays", people: "Personnes", total: "Total", cancel: "Annuler", confirm: "Confirmer", okT: "Réservation reçue !", okP1: "Votre place est réservée.", okP2: "Vous recevrez la confirmation par email.", code: "Code", close: "Fermer", sending: "Envoi…", reqName: "Indiquez votre nom", reqEmail: "Indiquez un email valide", errGen: "Impossible de finaliser la réservation. Réessayez.", mk: "Je souhaite recevoir les actualités et offres de Binifadet par email" },
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function ReservarApp({ initialLang }: { initialLang: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const hoy = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [view, setView] = useState<Date>(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const [selected, setSelected] = useState<string | null>(null);
  const [sesiones, setSesiones] = useState<Sesion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [modal, setModal] = useState<{ sesion: Sesion; qty: number } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errModal, setErrModal] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState<string | null>(null);

  const t = T[lang];
  const euro = (n: number) => (Number(n) || 0).toLocaleString(LOCALE[lang], { style: "currency", currency: "EUR" });
  const nombre = (p: Prod) => (lang === "en" ? p.nombre_en : lang === "fr" ? p.nombre_fr : p.nombre_es) || p.nombre_es;

  const cargarMes = useCallback(async () => {
    setCargando(true);
    const mes = `${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, "0")}`;
    try {
      const res = await fetch(`/api/publico/visitas/sesiones?mes=${mes}`);
      const json = await res.json();
      setSesiones(Array.isArray(json.sesiones) ? json.sesiones : []);
    } catch {
      setSesiones([]);
    }
    setCargando(false);
  }, [view]);

  useEffect(() => {
    cargarMes();
  }, [cargarMes]);

  // Autoajuste de altura si se embebe en un iframe.
  useEffect(() => {
    const post = () => {
      try {
        parent.postMessage({ binifadetHeight: document.body.scrollHeight }, "*");
      } catch {
        /* noop */
      }
    };
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  const sesByDay = useMemo(() => {
    const m: Record<string, Sesion[]> = {};
    sesiones.forEach((s) => {
      (m[s.fecha] = m[s.fecha] || []).push(s);
    });
    return m;
  }, [sesiones]);

  const hoyI = iso(hoy);

  function nav(d: number) {
    setSelected(null);
    setView((v) => new Date(v.getFullYear(), v.getMonth() + d, 1));
  }
  function getQty(id: string) {
    return qty[id] || 1;
  }
  function setSesQty(id: string, n: number, max: number) {
    setQty((q) => ({ ...q, [id]: Math.min(Math.max(1, n), max) }));
  }

  async function submitReserva() {
    if (!modal) return;
    setErrModal(null);
    const form = document.getElementById("rsv-form") as HTMLFormElement | null;
    const nombreC = (form?.querySelector<HTMLInputElement>("#rs_nombre")?.value || "").trim();
    const email = (form?.querySelector<HTMLInputElement>("#rs_email")?.value || "").trim();
    const tel = (form?.querySelector<HTMLInputElement>("#rs_tel")?.value || "").trim();
    const pais = (form?.querySelector<HTMLInputElement>("#rs_pais")?.value || "").trim();
    if (!nombreC) return setErrModal(t.reqName);
    if (!/.+@.+\..+/.test(email)) return setErrModal(t.reqEmail);
    setEnviando(true);
    try {
      const res = await fetch("/api/publico/visitas/reserva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sesion_id: modal.sesion.id,
          nombre: nombreC,
          email,
          telefono: tel,
          pais,
          idioma: lang,
          personas: modal.qty,
          marketing,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEnviando(false);
        return setErrModal(t.errGen);
      }
      setEnviando(false);
      setConfirmado(json.codigo_reserva || "");
    } catch {
      setEnviando(false);
      setErrModal(t.errGen);
    }
  }

  function cerrarModal() {
    setModal(null);
    setConfirmado(null);
    setErrModal(null);
  }

  // ----- calendario -----
  const y = view.getFullYear();
  const m = view.getMonth();
  const monthName = new Intl.DateTimeFormat(LOCALE[lang], { month: "long", year: "numeric" }).format(view);
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const canPrev = !(y === hoy.getFullYear() && m === hoy.getMonth());

  const celdas: React.ReactNode[] = [];
  for (let i = 0; i < 42; i++) {
    const dayNum = i - firstDow + 1;
    if (dayNum < 1) {
      celdas.push(<div key={"p" + i} className="cell out">{prevDays + dayNum}</div>);
    } else if (dayNum > daysInMonth) {
      celdas.push(<div key={"n" + i} className="cell out">{dayNum - daysInMonth}</div>);
    } else {
      const dstr = `${y}-${String(m + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      const isToday = dstr === hoyI;
      const isPast = dstr < hoyI;
      const isAvail = !!sesByDay[dstr];
      const isSel = dstr === selected;
      let cls = "cell";
      if (isSel) cls += " sel";
      else if (isAvail) cls += " avail";
      if (isToday && !isSel) cls += " today";
      if (isPast && !isAvail) cls += " past";
      celdas.push(
        <div
          key={dstr}
          className={cls}
          onClick={isAvail && !isSel ? () => setSelected(dstr) : undefined}
        >
          {dayNum}
        </div>,
      );
    }
  }

  const lista = selected ? (sesByDay[selected] || []).slice().sort((a, b) => a.hora.localeCompare(b.hora)) : [];
  const dlong = selected
    ? new Intl.DateTimeFormat(LOCALE[lang], { weekday: "long", day: "numeric", month: "long" }).format(new Date(selected + "T00:00:00"))
    : "";

  return (
    <div className="rsv">
      <div className="wrap">
        <div className="langbar">
          {LANGS.map((l) => (
            <button key={l} className={l === lang ? "on" : ""} onClick={() => setLang(l)}>{l}</button>
          ))}
        </div>
        <div className="intro">
          <h1>{t.title}</h1>
          <p>{t.sub}</p>
        </div>

        <div className="cal">
          {cargando ? (
            <div className="loading"><span className="spinner" /></div>
          ) : (
            <>
              <div className="cal-h">
                <button disabled={!canPrev} onClick={() => canPrev && nav(-1)}>‹</button>
                <span className="title">{monthName}</span>
                <button onClick={() => nav(1)}>›</button>
              </div>
              <div className="cal-grid">
                {DOW[lang].map((d) => <div key={d} className="dow">{d}</div>)}
                {celdas}
              </div>
            </>
          )}
        </div>

        {selected ? <div className="results-label">{t.results(dlong)}</div> : null}
        <div>
          {selected && lista.length === 0 ? <div className="noses">{t.none}</div> : null}
          {lista.map((s) => {
            const maxQ = Math.min(s.free, 20);
            const q = getQty(s.id);
            return (
              <div key={s.id} className="session">
                <div className="hora">{s.hora}</div>
                <div className="info">
                  <div className="nm">{nombre(s.producto)}</div>
                  <div className="meta">
                    {s.producto.duracion_min ? `${s.producto.duracion_min} min · ` : ""}
                    {t.left(s.free)}
                  </div>
                </div>
                <div className="precio">{euro(s.producto.precio)}</div>
                <div className="stepper">
                  <button onClick={() => setSesQty(s.id, q - 1, maxQ)}>−</button>
                  <span>{q}</span>
                  <button onClick={() => setSesQty(s.id, q + 1, maxQ)}>+</button>
                </div>
                <button className="buy" onClick={() => { setErrModal(null); setConfirmado(null); setModal({ sesion: s, qty: q }); }}>
                  {t.buy}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {modal ? (
        <div className="rsv-overlay" onClick={(e) => { if (e.target === e.currentTarget) cerrarModal(); }}>
          <div className="sheet">
            {confirmado !== null ? (
              <div className="ok-wrap">
                <div className="check">✓</div>
                <h2>{t.okT}</h2>
                <p>{t.okP1}</p>
                <div className="cod">{t.code}: {confirmado}</div>
                <p>{t.okP2}</p>
                <div style={{ marginTop: 18 }}>
                  <button className="buy" onClick={() => { cerrarModal(); cargarMes(); }}>{t.close}</button>
                </div>
              </div>
            ) : (
              <>
                <div className="sh"><h2>{t.book}</h2></div>
                <div className="resumen">
                  <div className="r"><span>{nombre(modal.sesion.producto)}</span><span>{modal.sesion.hora}</span></div>
                  <div className="r"><span style={{ textTransform: "capitalize" }}>{new Intl.DateTimeFormat(LOCALE[lang], { weekday: "long", day: "numeric", month: "long" }).format(new Date(modal.sesion.fecha + "T00:00:00"))}</span><span /></div>
                  <div className="r"><span>{modal.qty} × {euro(modal.sesion.producto.precio)}</span><span /></div>
                  <div className="r total"><span>{t.total}</span><span>{euro(modal.qty * modal.sesion.producto.precio)}</span></div>
                </div>
                <form id="rsv-form" className="body" onSubmit={(e) => e.preventDefault()}>
                  <div className="fld">
                    <label>{t.people}</label>
                    <div className="stepper" style={{ width: "fit-content" }}>
                      <button type="button" onClick={() => setModal((mo) => mo && { ...mo, qty: Math.max(1, mo.qty - 1) })}>−</button>
                      <span>{modal.qty}</span>
                      <button type="button" onClick={() => setModal((mo) => mo && { ...mo, qty: Math.min(Math.min(mo.sesion.free, 20), mo.qty + 1) })}>+</button>
                    </div>
                  </div>
                  <div className="fld"><label>{t.name}</label><input id="rs_nombre" /></div>
                  <div className="fld"><label>{t.email}</label><input id="rs_email" type="email" /></div>
                  <div className="fld"><label>{t.phone}</label><input id="rs_tel" /></div>
                  <div className="fld"><label>{t.country}</label><input id="rs_pais" /></div>
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--muted)", textTransform: "none", letterSpacing: 0, cursor: "pointer" }}>
                    <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} style={{ width: "auto", marginTop: 2 }} />
                    <span>{t.mk}</span>
                  </label>
                </form>
                {errModal ? <div className="err">{errModal}</div> : null}
                <div className="ft">
                  <button className="btn-ghost" onClick={cerrarModal}>{t.cancel}</button>
                  <button className="buy" disabled={enviando} onClick={submitReserva}>{enviando ? t.sending : t.confirm}</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
