"use client";

import { startTransition, useActionState, useState } from "react";
import CampoClave from "@/lib/campo-clave";
import { longitudValida } from "@/lib/clave";
import { cambiarRol, borrarUsuario, nuevaClaveTemporal } from "./acciones";
import { ERRORES } from "./errores";

const estiloBotonFila = {
  padding: "6px 10px", border: "1px solid #DDE2DF", borderRadius: 6,
  background: "#fff", cursor: "pointer", fontSize: 13,
} as const;

/**
 * Acciones de una fila de usuario: cambiar rol, nueva contraseña y borrar.
 * Es componente de cliente por lo que el servidor no puede dar: enviar el
 * formulario al cambiar el select (sin botón «Guardar» aparte), el panel de
 * contraseña y el confirm del borrado. Las acciones reales son de servidor y
 * revalidan sus permisos (y protegen a los operadores de Hostelero).
 */
export default function FilaAcciones({
  perfilId,
  rol,
  nombre,
  esYo,
  esOperador,
  gestionaUsuarios,
  soyOperador,
  roles,
}: {
  perfilId: string;
  rol: string;
  nombre: string;
  esYo: boolean;
  esOperador: boolean;
  /** Tiene la concesión de Usuarios: es un igual, su contraseña la cambia él. */
  gestionaUsuarios: boolean;
  /** Quien mira es operador de Hostelero: puede poner contraseña a operadores y gestores. */
  soyOperador: boolean;
  roles: { id: string; nombre: string }[];
}) {
  const [panelClave, setPanelClave] = useState(false);
  const puedeClave = soyOperador || (!esOperador && !gestionaUsuarios);
  const botonClave = (
    <button
      type="button"
      onClick={() => setPanelClave(true)}
      aria-haspopup="dialog"
      title={`Poner una contraseña temporal nueva a ${nombre}`}
      style={{ ...estiloBotonFila, color: "inherit" }}
    >
      Nueva contraseña
    </button>
  );

  if (esYo) {
    // El propio perfil no se toca desde aquí: ni rol ni borrado (candados de
    // las acciones). Mejor ni pintar los controles que explicar el error.
    return <span style={{ color: "#5F6B65", fontSize: 12 }}>tú</span>;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {esOperador ? (
          // Acceso global a todas las cuentas: ni rol, ni contraseña, ni
          // borrado desde aquí (las acciones lo rechazan igualmente).
          <>
            <span style={{ fontSize: 13 }}>{roles.find((r) => r.id === rol)?.nombre ?? rol}</span>
            <span
              title="Operador de Hostelero: su rol y su contraseña no se cambian desde una cuenta, ni se borra"
              style={{ color: "#5F6B65", fontSize: 12 }}
            >
              operador de Hostelero
            </span>
            {soyOperador && botonClave}
          </>
        ) : (
          <>
            <form action={cambiarRol}>
              <input type="hidden" name="perfil" value={perfilId} />
              <select
                name="rol"
                defaultValue={rol}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                style={{ padding: "6px 8px", border: "1px solid #DDE2DF", borderRadius: 6, fontSize: 13 }}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
              </select>
            </form>
            {gestionaUsuarios && !soyOperador ? (
              <span
                title="También gestiona Usuarios: su contraseña la cambia él en «Mi contraseña»"
                style={{ color: "#5F6B65", fontSize: 12 }}
              >
                gestiona Usuarios
              </span>
            ) : (
              botonClave
            )}
            <form
              action={borrarUsuario}
              onSubmit={(e) => {
                if (
                  !confirm(
                    `¿Borrar a ${nombre}? Perderá el acceso al momento y se borrará todo lo vinculado a su usuario (permisos y demás datos ligados a él). No se puede deshacer.\n\n` +
                      (gestionaUsuarios
                        ? "Si solo es que no puede entrar, cancela: que la cambie él en «Mi contraseña» o escribe a soporte de Hostelero."
                        : "Si solo es que no puede entrar, cancela y usa «Nueva contraseña».")
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="perfil" value={perfilId} />
              <button type="submit" title={`Borrar a ${nombre}`} style={{ ...estiloBotonFila, color: "#B42318" }}>
                Borrar
              </button>
            </form>
          </>
        )}
      </div>
      {panelClave && puedeClave && (
        <PanelClave perfilId={perfilId} nombre={nombre} alCerrar={() => setPanelClave(false)} />
      )}
    </div>
  );
}

/**
 * Panel de «Nueva contraseña». Se monta al abrirlo y se desmonta al cerrarlo,
 * así cada apertura empieza limpia (contraseña recién generada, sin estado
 * anterior). El error vuelve como estado y no se pierde lo escrito.
 *
 * Es una capa fija centrada y no un desplegable dentro de la celda: la tabla
 * tiene scroll horizontal y en el móvil el panel quedaba medio fuera de la
 * pantalla (y ensanchaba la columna de todas las filas). Solo se cierra con
 * sus botones: un toque fuera sin querer haría perder la contraseña guardada.
 */
function PanelClave({ perfilId, nombre, alCerrar }: { perfilId: string; nombre: string; alCerrar: () => void }) {
  const [estado, enviar, guardando] = useActionState(nuevaClaveTemporal, null);
  const [clave, setClave] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const hecho = !!estado && "ok" in estado;
  const mensaje = aviso ?? (estado && "error" in estado ? ERRORES[estado.error] : null);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 50, background: "rgba(20, 28, 24, 0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Nueva contraseña para ${nombre}`}
        style={{
          padding: 16, border: "1px solid #DDE2DF", borderRadius: 10, background: "var(--blanco, #fff)",
          whiteSpace: "normal", textAlign: "left", width: "min(440px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)", overflowY: "auto", boxShadow: "0 10px 30px rgba(0, 0, 0, 0.18)",
        }}
      >
        {hecho ? (
          <>
            <p style={{ margin: "0 0 10px", fontSize: 13 }}>
              Contraseña nueva guardada para <strong>{nombre}</strong>. La anterior ya no vale.
            </p>
            <CampoClave valor={clave} alCambiar={setClave} etiqueta="Contraseña temporal" soloLectura />
            <p style={{ margin: "6px 0 10px", fontSize: 13 }}>
              <strong>Pásasela por un canal privado</strong> (en persona o por mensaje directo, nunca en
              un grupo). Luego puede cambiarla en «Mi contraseña».
            </p>
            <button type="button" className="boton-secundario" onClick={alCerrar}>
              Cerrar
            </button>
          </>
        ) : (
          <form
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              if (guardando) return;
              if (!longitudValida(clave)) {
                setAviso(ERRORES.clave);
                return;
              }
              setAviso(null);
              const datos = new FormData(e.currentTarget);
              startTransition(() => enviar(datos));
            }}
          >
            <input type="hidden" name="perfil" value={perfilId} />
            {mensaje && (
              <p className="aviso-error" role="alert" style={{ marginBottom: 10 }}>
                {mensaje}
              </p>
            )}
            <CampoClave
              name="clave"
              valor={clave}
              alCambiar={setClave}
              etiqueta={`Contraseña temporal nueva para ${nombre}`}
              ayuda="Su contraseña actual dejará de valer. No se borra nada de lo suyo."
            />
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button className="boton" type="submit" disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              <button type="button" className="boton-secundario" onClick={alCerrar} disabled={guardando}>
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
