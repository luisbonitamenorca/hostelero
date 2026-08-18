"use client";

import { cambiarRol, borrarUsuario } from "./acciones";

/**
 * Acciones de una fila de usuario: cambiar rol y borrar. Es componente de
 * cliente solo por dos detalles que el servidor no puede dar: enviar el
 * formulario al cambiar el select (sin botón «Guardar» aparte) y el confirm
 * del borrado. Las acciones reales son de servidor y revalidan sus permisos.
 */
export default function FilaAcciones({
  perfilId,
  rol,
  nombre,
  esYo,
  roles,
}: {
  perfilId: string;
  rol: string;
  nombre: string;
  esYo: boolean;
  roles: { id: string; nombre: string }[];
}) {
  if (esYo) {
    // El propio perfil no se toca desde aquí: ni rol ni borrado (candados de
    // las acciones). Mejor ni pintar los controles que explicar el error.
    return <span style={{ color: "#5F6B65", fontSize: 12 }}>tú</span>;
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
      <form
        action={borrarUsuario}
        onSubmit={(e) => {
          if (!confirm(`¿Borrar a ${nombre}? Perderá el acceso al momento y no se puede deshacer.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="perfil" value={perfilId} />
        <button
          type="submit"
          title={`Borrar a ${nombre}`}
          style={{
            padding: "6px 10px", border: "1px solid #DDE2DF", borderRadius: 6,
            background: "#fff", color: "#B42318", cursor: "pointer", fontSize: 13,
          }}
        >
          Borrar
        </button>
      </form>
    </div>
  );
}
