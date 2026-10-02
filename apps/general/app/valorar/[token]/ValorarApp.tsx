"use client";

import { useEffect, useMemo, useState } from "react";
import { LANGS, NOMBRE_IDIOMA, esLang, textos, type Lang } from "../../reservar-mesa/textos";
import { detectarIdioma, estiloMarca, fmtFechaLarga, mensajeError, pedir, post, type Gestion } from "../../reservar-mesa/lib-widget";

/**
 * Valoración de la visita. Lee la ficha (gestion) para saber si se puede valorar y de qué
 * restaurante es; envía a /api/publico/reservas/valorar. Si la nota media es ≥ 4 y el
 * restaurante tiene url_resena_google, invita a dejar reseña.
 */
export default function ValorarApp({ token, lang: langUrl }: { token: string; lang: Lang | null }) {
  const [lang, setLang] = useState<Lang>(langUrl ?? "es");
  const t = textos(lang);
  const [g, setG] = useState<Gestion | null>(null);
  const [estado, setEstado] = useState<"cargando" | "ok" | "no">("cargando");
  const [comida, setComida] = useState(0);
  const [atencion, setAtencion] = useState(0);
  const [entorno, setEntorno] = useState(0);
  const [nps, setNps] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState<{ valoracion: number; url_resena: string | null } | null>(null);

  useEffect(() => {
    if (!langUrl) setLang(detectarIdioma(null));
  }, [langUrl]);

  useEffect(() => {
    if (!token) {
      setEstado("no");
      return;
    }
    pedir<Gestion>(`/api/publico/reservas/gestion?token=${token}`).then((j) => {
      if (j.error || !j.ok) return setEstado("no");
      setG(j);
      if (!langUrl && esLang(j.idioma)) setLang(j.idioma);
      setEstado("ok");
    });
  }, [token, langUrl]);

  async function enviar() {
    if (!comida || !atencion || !entorno) return setError(t.errores.VALORACION_INVALIDA);
    setOcupado(true);
    setError("");
    const j = await post<{ ok?: boolean; valoracion?: number; url_resena?: string | null }>("/api/publico/reservas/valorar", { token, comida, atencion, entorno, nps, comentario: comentario.trim() });
    setOcupado(false);
    if (j.error) return setError(mensajeError(t.errores, j.error));
    setHecho({ valoracion: j.valoracion ?? Math.round((comida + atencion + entorno) / 3), url_resena: j.url_resena ?? null });
    window.scrollTo({ top: 0 });
  }

  const estilo = useMemo(() => estiloMarca(g?.restaurante.color_marca), [g?.restaurante.color_marca]);

  const cabecera = (
    <header className="top">
      <div className="marca">
        {g?.restaurante.logo_url ? <img src={g.restaurante.logo_url} alt="" className="logo" /> : null}
        <span>{g?.restaurante.nombre ?? t.marca}</span>
      </div>
      <div className="idiomas" role="group" aria-label={t.idiomaAria}>
        {LANGS.map((l) => (
          <button key={l} type="button" lang={l} title={NOMBRE_IDIOMA[l]} className={lang === l ? "on" : ""} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
        ))}
      </div>
    </header>
  );

  if (estado === "cargando") {
    return <div className="rme"><div className="wrap">{cabecera}<div className="aviso info"><span className="cargando" />{t.cargando}</div></div></div>;
  }
  if (estado === "no" || !g) {
    return (
      <div className="rme">
        <div className="wrap">
          {cabecera}
          <h2 className="paso">{t.noEncontrada}</h2>
          <p className="sub">{t.noEncontradaSub}</p>
        </div>
      </div>
    );
  }

  const r = g.restaurante;

  if (hecho) {
    return (
      <div className="rme" style={estilo}>
        <div className="wrap">
          {cabecera}
          <h2 className="paso">{t.graciasValoracion}</h2>
          <div className="aviso ok">{"★".repeat(hecho.valoracion)}{"☆".repeat(5 - hecho.valoracion)}</div>
          {hecho.url_resena ? (
            <>
              <p className="sub">{t.resenaInvita}</p>
              <a className="btn" href={hecho.url_resena} target="_blank" rel="noopener noreferrer">{t.dejarResena}</a>
            </>
          ) : null}
          <p className="pie"><a href={`/reservar-mesa/${r.slug}?lang=${lang}`} style={{ color: "var(--acento)", fontWeight: 600 }}>{t.otraReserva}</a></p>
        </div>
      </div>
    );
  }

  if (!g.puede_valorar) {
    return (
      <div className="rme" style={estilo}>
        <div className="wrap">
          {cabecera}
          <h2 className="paso">{t.valorarTitulo}</h2>
          <div className="aviso info">{g.valoracion ? t.yaValorada : t.noValorable}</div>
          {g.valoracion && r.url_resena_google && g.valoracion >= 4 ? <a className="btn sec" href={r.url_resena_google} target="_blank" rel="noopener noreferrer">{t.dejarResena}</a> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="rme" style={estilo}>
      <div className="wrap">
        {cabecera}
        <h2 className="paso">{t.valorarTitulo}</h2>
        <p className="sub">{t.valorarSub(r.nombre)} · {fmtFechaLarga(g.fecha_iso, lang)}</p>
        <form
          className="card"
          onSubmit={(ev) => {
            ev.preventDefault();
            enviar();
          }}
        >
          <Estrellas etiqueta={t.comida} valor={comida} onChange={setComida} />
          <Estrellas etiqueta={t.atencion} valor={atencion} onChange={setAtencion} />
          <Estrellas etiqueta={t.entorno} valor={entorno} onChange={setEntorno} />
          <label>{t.nps}</label>
          <div className="nps" role="radiogroup" aria-label={t.nps}>
            {Array.from({ length: 11 }, (_, i) => (
              <button key={i} type="button" role="radio" aria-checked={nps === i} className={nps === i ? "sel" : ""} onClick={() => setNps(i)}>{i}</button>
            ))}
          </div>
          <div className="nps-pies"><span>{t.npsNo}</span><span>{t.npsSi}</span></div>
          <label htmlFor="v-com">{t.comentarioValoracion}</label>
          <textarea id="v-com" value={comentario} onChange={(ev) => setComentario(ev.target.value)} maxLength={2000} />
          {error ? <div className="aviso err">{error}</div> : null}
          <button className="btn" type="submit" disabled={ocupado}>{t.enviarValoracion}</button>
        </form>
      </div>
    </div>
  );
}

function Estrellas({ etiqueta, valor, onChange }: { etiqueta: string; valor: number; onChange: (n: number) => void }) {
  return (
    <>
      <label>{etiqueta}</label>
      <div className="estrellas" role="radiogroup" aria-label={etiqueta}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={valor === n} aria-label={`${n}/5`} className={n <= valor ? "on" : ""} onClick={() => onChange(n)}>★</button>
        ))}
      </div>
    </>
  );
}
