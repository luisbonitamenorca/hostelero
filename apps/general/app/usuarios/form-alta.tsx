"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import CampoClave from "@/lib/campo-clave";
import { generarClave, longitudValida } from "@/lib/clave";
import { crearUsuario } from "./acciones";
import { ERRORES } from "./errores";

/**
 * Formulario de alta. Es de cliente para que un error (contraseña filtrada,
 * correo repetido…) no obligue a reescribirlo todo:
 *
 * - crearUsuario devuelve el resultado como estado (useActionState), tanto
 *   el error como el éxito: no hay redirect.
 * - Se envía desde onSubmit con preventDefault + startTransition, NO con
 *   <form action={…}>: con action, React 19 resetea el formulario al acabar
 *   la acción aunque haya devuelto un error. Además los campos son
 *   controlados, así que no hay nada que resetear.
 * - En el éxito, el formulario se cambia por un bloque que enseña la MISMA
 *   contraseña que se acaba de poner (sale del estado del navegador: no
 *   vuelve del servidor ni pasa por la URL). No aparece otra hasta que se
 *   pulsa «Dar de alta a otra persona».
 */
export default function FormAlta({ roles }: { roles: { id: string; nombre: string; pista: string }[] }) {
  const [estado, enviar, creando] = useActionState(crearUsuario, null);
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  // Sin rol por defecto: se elige siempre a propósito (antes salía
  // «Dirección», el más alto, y era fácil dar de alta así a un empleado).
  const [rol, setRol] = useState("");
  const [clave, setClave] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  // Resultado ya atendido: «Dar de alta a otra persona» lo aparta y no se
  // vuelve a pintar (ni el éxito ni un error) hasta que llegue uno nuevo. Se
  // compara por objeto: cada respuesta de la acción es un estado distinto, y
  // mientras va el envío siguiente sigue estando el anterior.
  const [descartado, setDescartado] = useState<typeof estado>(null);
  // Hasta hidratar no hay onSubmit: el botón queda apagado para que el
  // navegador no haga un envío nativo con la contraseña.
  const [listo, setListo] = useState(false);
  useEffect(() => setListo(true), []);

  const vigente = estado !== descartado ? estado : null;

  if (vigente && "ok" in vigente) {
    return (
      <div className="tarjeta" style={{ borderColor: "var(--verde, #0F6E56)" }}>
        <div className="form-bloque">
          <p className="aviso-ok" role="status" style={{ margin: 0 }}>
            <strong>{vigente.nombre}</strong> ya puede entrar con su correo y la contraseña temporal.
            Pásasela por un canal privado; luego puede cambiarla en Mi contraseña (arriba en la
            portada).
          </p>
          <div style={{ maxWidth: 440 }}>
            <CampoClave
              valor={clave}
              alCambiar={setClave}
              etiqueta={`Contraseña temporal de ${vigente.nombre}`}
              soloLectura
            />
          </div>
          <button
            type="button"
            className="boton-secundario"
            style={{ justifySelf: "start" }}
            onClick={() => {
              setNombre("");
              setCorreo("");
              setRol("");
              setClave(generarClave());
              setAviso(null);
              setDescartado(estado);
            }}
          >
            Dar de alta a otra persona
          </button>
        </div>
      </div>
    );
  }

  // Mientras va, no se enseña el error del intento anterior.
  const mensaje = creando
    ? null
    : (aviso ?? (vigente && "error" in vigente ? ERRORES[vigente.error] : null));

  return (
    <>
      {mensaje && (
        <p className="aviso-error" role="alert">
          {mensaje}
        </p>
      )}
      <div className="tarjeta">
        <form
          method="post"
          className="form-bloque"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", alignItems: "end" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (creando) return;
            if (!rol) {
              setAviso("Elige el rol de la persona.");
              return;
            }
            if (!longitudValida(clave)) {
              setAviso(ERRORES.clave);
              return;
            }
            setAviso(null);
            const datos = new FormData(e.currentTarget);
            startTransition(() => enviar(datos));
          }}
        >
          <div className="campo">
            <label htmlFor="alta-nombre">Nombre</label>
            <input
              id="alta-nombre"
              name="nombre"
              type="text"
              required
              placeholder="Sonia"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="alta-correo">Correo</label>
            <input
              id="alta-correo"
              name="correo"
              type="email"
              required
              placeholder="sonia@bonitamenorca.com"
              autoComplete="off"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="alta-rol">Rol</label>
            <select id="alta-rol" name="rol" required value={rol} onChange={(e) => setRol(e.target.value)}>
              <option value="" disabled>
                Elige rol…
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre} — {r.pista}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <CampoClave
              name="clave"
              valor={clave}
              alCambiar={setClave}
              etiqueta="Contraseña temporal"
              ayuda="Al crear el usuario se vuelve a enseñar para copiarla. Si se pierde, «Nueva contraseña» en su fila."
            />
          </div>
          <button className="boton" type="submit" disabled={!listo || creando} style={{ width: "auto" }}>
            {creando ? "Creando…" : "Crear usuario"}
          </button>
        </form>
      </div>
    </>
  );
}
