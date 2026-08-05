"use client";

import { useMemo, useState } from "react";

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
  const [texto, setTexto] = useState("");
  const [centro, setCentro] = useState("");
  const [estado, setEstado] = useState("");

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

  return (
    <main className="contenido curso-panel">
      <div className="curso-cabecera-fila">
        <h1 className="titulo">Inscripciones</h1>
        <button className="boton-secundario" onClick={exportarCSV}>
          Exportar CSV
        </button>
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
              <th>Email</th>
              <th>Centro</th>
              <th>Puesto</th>
              <th>Estado</th>
              <th>Nota</th>
              <th>Certificado</th>
              <th>Fecha</th>
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
                    <span className="curso-suave">{d.telefono}</span>
                  </td>
                  <td>{d.dni ?? (d.dni_purgado_en ? "(purgado)" : "—")}</td>
                  <td>
                    <a href={`mailto:${d.email}`}>{d.email}</a>
                  </td>
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
