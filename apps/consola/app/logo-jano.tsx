/** Identidad Jano (ficha «Pizarra y Salvia», octubre 2026).
 *  El anillo partido de Jano mira a dos lados; el núcleo son tus datos.
 *  El icono hereda el color del texto (currentColor); el núcleo va en salvia.
 *  La misma copia vive en apps/general, apps/finanzas y apps/consola: las
 *  tres replican la identidad a mano, igual que las variables CSS. */

export function IconoJano({
  tamano = 20,
  titulo = "Jano",
  estilo,
}: {
  tamano?: number;
  titulo?: string;
  estilo?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={tamano}
      height={tamano}
      role="img"
      aria-label={titulo}
      style={{ display: "inline-block", verticalAlign: "-0.1em", flex: "none", ...estilo }}
    >
      <defs>
        <path
          id="jano-anillo"
          fillRule="evenodd"
          d="M50 4 A46 46 0 0 1 94 31 V69 A46 46 0 0 1 50 96 A46 46 0 0 1 6 69 V31 A46 46 0 0 1 50 4 Z M50 25 A25 25 0 1 0 50 75 A25 25 0 1 0 50 25 Z"
        />
        <clipPath id="jano-izq"><rect x="-10" y="-20" width="56" height="140" /></clipPath>
        <clipPath id="jano-der"><rect x="54" y="-20" width="56" height="140" /></clipPath>
      </defs>
      <g fill="currentColor">
        <use href="#jano-anillo" clipPath="url(#jano-izq)" transform="translate(0 -2.5)" />
        <use href="#jano-anillo" clipPath="url(#jano-der)" transform="translate(0 2.5)" />
      </g>
      <circle cx="50" cy="50" r="10" fill="var(--salvia, #8FAE8B)" />
    </svg>
  );
}

/** Logotipo: «jan» + el anillo haciendo de «o». Se escala con font-size. */
export function LogoJano({ tamano = 22, sufijo }: { tamano?: number; sufijo?: string }) {
  return (
    <span
      className="logo-jano"
      style={{ display: "inline-flex", alignItems: "center", gap: tamano * 0.5, fontSize: tamano, lineHeight: 1 }}
    >
      <span style={{ display: "inline-flex", alignItems: "baseline", fontWeight: 800, letterSpacing: "-0.04em" }}>
        <span>jan</span>
        {/* El anillo hace de «o»: altura de la x de Plus Jakarta Sans con un pelo de rebase */}
        <IconoJano tamano={tamano * 0.62} estilo={{ position: "relative", top: tamano * 0.035, marginLeft: tamano * 0.02 }} />
      </span>
      {sufijo && <span style={{ fontWeight: 400, letterSpacing: 0, fontSize: tamano * 0.82 }}>{sufijo}</span>}
    </span>
  );
}
