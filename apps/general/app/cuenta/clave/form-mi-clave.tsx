"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useState } from "react";
import CampoClave from "@/lib/campo-clave";
import { longitudValida } from "@/lib/clave";
import { cerrarSesion } from "@/app/acciones";
import { cambiarMiClave } from "./acciones";
import { ERRORES_MI_CLAVE } from "./errores";

/**
 * Formulario de «Mi contraseña». Mismo patrón que el alta de Usuarios:
 * onSubmit + startTransition sobre useActionState (sin <form action>), para
 * que un error no vacíe lo escrito.
 *
 * A diferencia de la temporal (que hay que dictar), esta es la contraseña
 * personal: va oculta y solo se ve al pulsar «Mostrar» o justo después de
 * «Generar» (para poder apuntarla).
 */
export default function FormMiClave() {
  const [estado, enviar, guardando] = useActionState(cambiarMiClave, null);
  const [actual, setActual] = useState("");
  const [clave, setClave] = useState("");
  const [repetida, setRepetida] = useState("");
  const [visible, setVisible] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Hasta hidratar no hay onSubmit: botón apagado para evitar un envío nativo.
  const [listo, setListo] = useState(false);
  useEffect(() => setListo(true), []);

  if (estado && "ok" in estado) {
    return (
      <>
        <p className="aviso-ok" role="status">
          Contraseña cambiada. La próxima vez que entres, usa la nueva.
        </p>
        <Link href="/" className="boton-enlace">
          Ir a Inicio
        </Link>
      </>
    );
  }

  const errorServidor = !guardando && estado && "error" in estado ? estado.error : null;
  const mensaje = aviso ?? (errorServidor ? ERRORES_MI_CLAVE[errorServidor] : null);

  return (
    <>
      <form
        method="post"
        className="formulario"
        style={{ padding: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (guardando) return;
          if (!actual) {
            setAviso(ERRORES_MI_CLAVE.actual);
            return;
          }
          if (!longitudValida(clave)) {
            setAviso(ERRORES_MI_CLAVE.clave);
            return;
          }
          if (clave !== repetida) {
            setAviso(ERRORES_MI_CLAVE.distintas);
            return;
          }
          setAviso(null);
          const datos = new FormData(e.currentTarget);
          startTransition(() => enviar(datos));
        }}
      >
        {mensaje && (
          <p className="aviso-error" role="alert" style={{ margin: 0 }}>
            {mensaje}
          </p>
        )}
        <div className="campo">
          <label htmlFor="mi-clave-actual">Contraseña actual (o la temporal que te dieron)</label>
          <input
            id="mi-clave-actual"
            name="actual"
            type="password"
            required
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            autoComplete="current-password"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
        <CampoClave
          name="clave"
          valor={clave}
          alCambiar={setClave}
          etiqueta="Nueva contraseña"
          ayuda="Escríbela tú o pulsa «Generar». Si la generas, apúntala o guárdala en el móvil antes de guardar. Mínimo 8 caracteres."
          generarAlMontar={false}
          autoComplete="new-password"
          visible={visible}
          alCambiarVisible={setVisible}
        />
        <div className="campo">
          <label htmlFor="mi-clave-repetida">Repítela (para asegurarte de que la recuerdas)</label>
          <input
            id="mi-clave-repetida"
            name="repetida"
            type={visible ? "text" : "password"}
            required
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            style={{ fontFamily: "var(--mono)", fontSize: 16 }}
          />
        </div>
        <button
          className="boton"
          type="submit"
          disabled={!listo || guardando}
          style={{ background: "var(--verde)" }}
        >
          {guardando ? "Guardando…" : "Guardar contraseña"}
        </button>
      </form>
      {errorServidor === "reautenticar" && (
        // Atajo para el único error que pide salir: sin él había que volver,
        // buscar «Salir» y luego encontrar otra vez esta pantalla.
        <form action={cerrarSesion} style={{ marginTop: 12 }}>
          <button className="boton-secundario" type="submit">
            Salir y volver a entrar
          </button>
        </form>
      )}
    </>
  );
}
