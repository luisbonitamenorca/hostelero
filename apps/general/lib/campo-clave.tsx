"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CLAVE_MIN, generarClave } from "./clave";

/**
 * Campo de contraseña VISIBLE con «Generar» y «Copiar». Visible a propósito:
 * es una contraseña temporal que hay que dictar o pasar a otra persona, y
 * con puntitos se cuelan erratas que luego nadie sabe explicar.
 *
 * Controlado: el valor vive en el formulario padre (así React no lo vacía
 * al terminar una acción y el padre puede validarlo antes de enviar).
 *
 * Para una contraseña PROPIA («Mi contraseña») el padre pasa `visible` y
 * `alCambiarVisible`: entonces va oculta con un botón «Mostrar», y solo se ve
 * en claro al pulsarlo o justo después de «Generar» (hay que poder leerla
 * para apuntarla).
 */
export default function CampoClave({
  name,
  valor,
  alCambiar,
  etiqueta = "Contraseña",
  ayuda,
  generarAlMontar = true,
  soloLectura = false,
  autoComplete = "off",
  visible = true,
  alCambiarVisible,
}: {
  name?: string;
  valor: string;
  alCambiar: (valor: string) => void;
  etiqueta?: string;
  ayuda?: string;
  /** Rellenar con una generada al aparecer el campo (si está vacío). */
  generarAlMontar?: boolean;
  /** Solo para mostrarla y copiarla (sin «Generar» ni edición). */
  soloLectura?: boolean;
  autoComplete?: string;
  /** Con alCambiarVisible: si se ve en claro o va oculta (type="password"). */
  visible?: boolean;
  alCambiarVisible?: (visible: boolean) => void;
}) {
  const id = useId();
  const caja = useRef<HTMLInputElement>(null);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copia, setCopia] = useState<"ok" | "fallo" | null>(null);

  // Se genera al montar y no durante el render: el servidor y el navegador
  // tienen que pintar lo mismo o la hidratación se rompe (y en el servidor
  // no hay que gastar aleatoriedad en algo que el navegador va a tirar).
  useEffect(() => {
    if (generarAlMontar && !soloLectura && !valor) alCambiar(generarClave());
    // Solo al montar: después manda lo que haga la persona.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (reloj.current) clearTimeout(reloj.current);
    },
    []
  );

  async function copiar() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(valor);
      ok = true;
    } catch {
      // Sin HTTPS, sin permiso o navegador antiguo: respaldo a la vieja usanza.
    }
    if (!ok && caja.current) {
      caja.current.focus();
      caja.current.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    setCopia(ok ? "ok" : "fallo");
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = setTimeout(() => setCopia(null), 2500);
  }

  // Los gestores de contraseñas no deben guardar la temporal de OTRA persona
  // como si fuera la tuya: solo se les deja actuar si el padre lo pide.
  const ignorarGestores = autoComplete === "off";
  const ocultable = !!alCambiarVisible;
  const enClaro = !ocultable || visible;

  return (
    <div className="campo" style={{ margin: 0 }}>
      <label htmlFor={id}>{etiqueta}</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          ref={caja}
          id={id}
          name={name}
          type={enClaro ? "text" : "password"}
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          readOnly={soloLectura}
          required={!soloLectura}
          minLength={CLAVE_MIN}
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          data-lpignore={ignorarGestores ? "true" : undefined}
          data-1p-ignore={ignorarGestores ? "true" : undefined}
          style={{ flex: "1 1 200px", minWidth: 0, fontFamily: "var(--mono)", fontSize: 16 }}
        />
        {!soloLectura && (
          <button
            type="button"
            className="boton-secundario"
            onClick={() => {
              alCambiar(generarClave());
              alCambiarVisible?.(true);
            }}
          >
            Generar
          </button>
        )}
        {ocultable && (
          <button
            type="button"
            className="boton-secundario"
            onClick={() => alCambiarVisible?.(!visible)}
            aria-pressed={visible}
          >
            {visible ? "Ocultar" : "Mostrar"}
          </button>
        )}
        <button type="button" className="boton-secundario" onClick={copiar} disabled={!valor}>
          Copiar
        </button>
      </div>
      <span
        aria-live="polite"
        style={{
          fontSize: 12,
          minHeight: 18,
          color: copia === "ok" ? "var(--verde)" : copia === "fallo" ? "#A32D2D" : "var(--gris)",
        }}
      >
        {copia === "ok"
          ? "Copiada"
          : copia === "fallo"
            ? "No se pudo copiar: selecciónala y cópiala a mano."
            : ayuda}
      </span>
    </div>
  );
}
