"use client";

import { useEffect, useState } from "react";
import { IconoJano, LogoJano } from "@/app/logo-jano";

/**
 * Banner de presentación de la identidad Jano (octubre 2026, Luis): la
 * portada de la ficha «Pizarra y Salvia» para que todo el que entre la vea y
 * empiece el debate. Se cierra con «Entendido» y no vuelve en ese navegador.
 * Es de quita y pon: para retirarlo basta con borrar <BannerJano /> de la
 * portada y de /empleado. Colores en hex porque /empleado no carga globals.css.
 */
const CLAVE = "jano-banner-identidad-v1";
const PIZARRA = "#2F3A45";
const SALVIA = "#8FAE8B";
const SALVIA_OSCURA = "#5E7D5A";
const CAL = "#F3F4F0";

export default function BannerJano() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(CLAVE)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function cerrar() {
    try {
      localStorage.setItem(CLAVE, new Date().toISOString());
    } catch {
      /* sin almacenamiento: se cierra solo esta vez */
    }
    setVisible(false);
  }

  if (!visible) return null;

  const etiqueta: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", margin: "2px 0 8px",
  };
  const texto: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.55, margin: "0 0 8px" };

  return (
    <section
      style={{
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        background: "#fff", color: PIZARRA, border: "1px solid #DEDFE1", borderRadius: 14,
        padding: "20px 20px 16px", margin: "0 auto 24px", maxWidth: 1100, boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: "#8A949C", textTransform: "uppercase" }}>
          Nueva identidad · Propuesta
        </div>
        <div style={{ fontSize: 14, color: PIZARRA }}>Las dos caras de tu negocio, a la vista.</div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", margin: "18px 0 18px" }}>
        <div style={{ color: PIZARRA, ["--salvia" as string]: SALVIA }}>
          <LogoJano tamano={56} />
          <div style={{ fontSize: 20, color: "#5C6872", marginTop: 2 }}>software</div>
        </div>
        <p style={{ ...texto, maxWidth: 360, color: "#5C6872", margin: 0 }}>
          Jano es la plataforma de gestión; Atenea, su asistente de IA. Paleta pizarra y salvia: serena, sobria.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        <div style={{ background: PIZARRA, color: "#fff", borderRadius: 12, padding: 18, display: "flex", gap: 14 }}>
          <span style={{ background: "#3D4955", borderRadius: 10, width: 48, height: 48, display: "grid", placeItems: "center", flex: "none", color: "#fff", ["--salvia" as string]: SALVIA }}>
            <IconoJano tamano={30} />
          </span>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>Jano</div>
            <div style={{ ...etiqueta, color: SALVIA }}>La plataforma · el que lo ve todo</div>
            <p style={{ ...texto, color: "#DEDFE1" }}>
              Dios romano de las puertas, los comienzos y los finales. Tiene dos caras: mira a la vez hacia delante y
              hacia atrás, hacia dentro y hacia fuera. Enero (<i>Ianuarius</i>) lleva su nombre porque abre el año.
            </p>
            <p style={{ ...texto, color: "#DEDFE1", margin: 0 }}>
              Por eso es la plataforma: ve las dos caras de tu negocio (sala y cocina, ventas y compras, ayer y
              mañana), preside cada apertura y cada cierre de caja y no se le escapa nada.
            </p>
          </div>
        </div>

        <div style={{ background: CAL, borderRadius: 12, padding: 18, display: "flex", gap: 14 }}>
          <span style={{ background: SALVIA, borderRadius: "50%", width: 48, height: 48, display: "grid", placeItems: "center", flex: "none" }} aria-hidden>
            <svg viewBox="0 0 40 40" width={30} height={30}>
              <g fill="none" stroke={PIZARRA} strokeWidth={2.2} strokeLinecap="round">
                <path d="M11 31 L29 9" />
              </g>
              <g fill={PIZARRA}>
                <ellipse cx="17" cy="19" rx="2.4" ry="5.5" transform="rotate(-25 17 19)" />
                <ellipse cx="22" cy="13" rx="2.4" ry="5.5" transform="rotate(-25 22 13)" />
                <ellipse cx="22" cy="23" rx="2.4" ry="5.5" transform="rotate(65 22 23)" />
                <ellipse cx="27" cy="17" rx="2.2" ry="5" transform="rotate(65 27 17)" />
              </g>
              <circle cx="14.5" cy="29" r="2.6" fill="#fff" />
            </svg>
          </span>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>Atenea</div>
            <div style={{ ...etiqueta, color: "#5C6872" }}>La asistente · la que aconseja</div>
            <p style={texto}>
              Diosa griega de la sabiduría, la estrategia y los oficios. Fue la consejera que acompañó a Ulises sin
              quitarle el timón. Su árbol es el olivo: se lo regaló a Atenas y por eso la ciudad lleva su nombre.
            </p>
            <p style={{ ...texto, margin: 0 }}>
              Vive dentro de Jano: lee todo lo que él vigila y te dice qué hacer, como cuánto pedir, a quién poner el
              sábado o qué plato te está costando dinero. Tú decides.
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", marginTop: 14 }}>
        <a href="/jano-identidad.pdf" target="_blank" rel="noopener" style={{ color: SALVIA_OSCURA, fontSize: 14, fontWeight: 600 }}>
          Ver el documento completo
        </a>
        <button
          onClick={cerrar}
          style={{
            background: PIZARRA, color: "#fff", border: 0, borderRadius: 8, padding: "9px 18px",
            font: "600 14px 'Plus Jakarta Sans', system-ui, sans-serif", cursor: "pointer",
          }}
        >
          Entendido
        </button>
      </div>
    </section>
  );
}
