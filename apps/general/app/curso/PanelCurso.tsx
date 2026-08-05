"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { borrarInscripcion } from "./acciones";

export type Inscripcion = {
  id: string;
  nombre: string;
  apellidos: string;
  dni: string | null;
  dni_purgado_en: string | null;
  email: string;
  telefono: string;
  centro_id: string;
  puesto: string;
  estado: "iniciado" | "aprobado" | "suspenso_intento" | "suspenso_definitivo";
  nota_final: number | null;
  codigo_certificado: string | null;
  fecha_certificado: string | null;
  creado_en: string;
};

type Centro = { id: string; nombre: string };

const ETIQUETA_ESTADO: Record<Inscripcion["estado"], string> = {
  iniciado: "En curso",
  aprobado: "Aprobado",
  suspenso_intento: "Suspenso (reintentable)",
  suspenso_definitivo: "Suspenso definitivo",
};

export default function PanelCurso({
  inscripciones,
  centros,
}: {
  inscripciones: Inscripcion[];
  centros: Centro[];
}) {
  const router = useRouter();
  const [vista, setVista] = useState<"inscripciones" | "front">("inscripciones");
  const [texto, setTexto] = useState("");
  const [centro, setCentro] = useState("");
  const [estado, setEstado] = useState("");
  const [copiado, setCopiado] = useState(false);

  const nombreCentro = useMemo(
    () => Object.fromEntries(centros.map((c) => [c.id, c.nombre])),
    [centros]
  );

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return inscripciones.filter((d) => {
      if (centro && d.centro_id !== centro) return false;
      if (estado && d.estado !== estado) return false;
      if (!t) return true;
      return (
        `${d.nombre} ${d.apellidos}`.toLowerCase().includes(t) ||
        (d.dni ?? "").toLowerCase().includes(t) ||
        d.email.toLowerCase().includes(t) ||
        (d.codigo_certificado ?? "").toLowerCase().includes(t)
      );
    });
  }, [inscripciones, texto, centro, estado]);

  const stats = useMemo(
    () => ({
      total: inscripciones.length,
      aprobados: inscripciones.filter((d) => d.estado === "aprobado").length,
      enCurso: inscripciones.filter((d) => d.estado === "iniciado").length,
      suspensos: inscripciones.filter((d) => d.estado === "suspenso_definitivo").length,
    }),
    [inscripciones]
  );

  function exportarCSV() {
    const cabeceras = [
      "Nombre",
      "DNI",
      "Email",
      "Teléfono",
      "Centro",
      "Puesto",
      "Estado",
      "Nota",
      "Código certificado",
      "Fecha certificado",
      "Fecha inscripción",
    ];
    const filas = filtradas.map((d) => [
      `${d.nombre} ${d.apellidos}`,
      d.dni ?? (d.dni_purgado_en ? "(purgado)" : ""),
      d.email,
      d.telefono,
      nombreCentro[d.centro_id] ?? "",
      d.puesto,
      d.estado,
      d.nota_final ?? "",
      d.codigo_certificado ?? "",
      d.fecha_certificado ? new Date(d.fecha_certificado).toLocaleDateString("es-ES") : "",
      new Date(d.creado_en).toLocaleDateString("es-ES"),
    ]);
    const csv = [cabeceras, ...filas]
      .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `manipulador_alimentos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function eliminar(d: Inscripcion) {
    if (
      !confirm(
        `¿Eliminar la inscripción de ${d.nombre} ${d.apellidos} (${ETIQUETA_ESTADO[d.estado]}) y sus intentos? Esta acción no se puede deshacer.`
      )
    )
      return;
    const r = await borrarInscripcion(d.id);
    if (!r.ok && r.error) alert(r.error);
    router.refresh();
  }

  async function copiarEnlace() {
    await navigator.clipboard.writeText(`${window.location.origin}/formacion`);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  if (vista === "front") {
    return (
      <main className="contenido curso-panel">
        <div className="curso-pestanas">
          <button className="curso-pestana" onClick={() => setVista("inscripciones")}>
            Inscripciones
          </button>
          <button className="curso-pestana activa">Front</button>
        </div>
        <div className="curso-cabecera-fila">
          <div>
            <h1 className="titulo">Front del curso</h1>
            <p className="curso-suave" style={{ margin: "4px 0 0" }}>
              La misma página que ve el empleado (/formacion). Lo que registres aquí es
              real: aparecerá en Inscripciones.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="boton-secundario" onClick={copiarEnlace}>
              {copiado ? "✓ Copiado" : "Copiar enlace"}
            </button>
            <a
              className="boton-secundario"
              style={{ textDecoration: "none" }}
              href="/formacion"
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir en pestaña nueva ↗
            </a>
          </div>
        </div>
        <div className="curso-tabla-envoltorio" style={{ overflow: "hidden" }}>
          <iframe
            src="/formacion"
            title="Front público del curso"
            style={{
              width: "100%",
              height: "calc(100vh - 280px)",
              minHeight: 600,
              border: 0,
              display: "block",
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="contenido curso-panel">
      <div className="curso-pestanas">
        <button className="curso-pestana activa">Inscripciones</button>
        <button className="curso-pestana" onClick={() => setVista("front")}>
          Front
        </button>
      </div>
      <div className="curso-cabecera-fila">
        <h1 className="titulo">Inscripciones</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="boton-secundario" onClick={copiarEnlace}>
            {copiado ? "✓ Copiado" : "Copiar enlace del curso"}
          </button>
          <button className="boton-secundario" onClick={exportarCSV}>
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="curso-stats">
        <div className="curso-stat info">
          <div className="lbl">Total inscripciones</div>
          <div className="num">{stats.total}</div>
        </div>
        <div className="curso-stat ok">
          <div className="lbl">Aprobados</div>
          <div className="num">{stats.aprobados}</div>
        </div>
        <div className="curso-stat">
          <div className="lbl">En curso</div>
          <div className="num">{stats.enCurso}</div>
        </div>
        <div className="curso-stat aviso">
          <div className="lbl">Suspensos definitivos</div>
          <div className="num">{stats.suspensos}</div>
        </div>
      </div>

      <div className="curso-filtros">
        <input
          type="text"
          placeholder="Buscar por nombre, DNI, email, certificado..."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <select value={centro} onChange={(e) => setCentro(e.target.value)}>
          <option value="">Todos los centros</option>
          {centros.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="iniciado">Iniciado</option>
          <option value="aprobado">Aprobado</option>
          <option value="suspenso_intento">Suspenso (puede reintentar)</option>
          <option value="suspenso_definitivo">Suspenso definitivo</option>
        </select>
      </div>

      <div className="curso-tabla-envoltorio">
        <table className="curso-tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>DNI</th>
              <th>Centro</th>
              <th>Puesto</th>
              <th>Estado</th>
              <th>Nota</th>
              <th>Certificado</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 ? (
              <tr>
                <td colSpan={9} className="curso-vacio">
                  No hay registros que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              filtradas.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>
                      {d.nombre} {d.apellidos}
                    </strong>
                    <br />
                    <span className="curso-suave">
                      <a href={`mailto:${d.email}`}>{d.email}</a> · {d.telefono}
                    </span>
                  </td>
                  <td>{d.dni ?? (d.dni_purgado_en ? "(purgado)" : "—")}</td>
                  <td>{nombreCentro[d.centro_id] ?? "—"}</td>
                  <td>{d.puesto}</td>
                  <td>
                    <span className={`curso-badge ${d.estado}`}>
                      {ETIQUETA_ESTADO[d.estado]}
                    </span>
                  </td>
                  <td>{d.nota_final != null ? `${d.nota_final}/20` : "—"}</td>
                  <td>{d.codigo_certificado ?? "—"}</td>
                  <td>{new Date(d.creado_en).toLocaleDateString("es-ES")}</td>
                  <td>
                    {d.estado !== "aprobado" && (
                      <button
                        className="curso-boton-mini curso-rojo"
                        title="Eliminar inscripción no acabada"
                        onClick={() => eliminar(d)}
                      >
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
