"use client";

import "./formacion.css";
import { useMemo, useRef, useState } from "react";
import { MODULOS } from "./contenido";

/**
 * Curso de Manipulador de Alimentos — port del front legado.
 * Diferencia clave con el original: el examen se corrige EN EL SERVIDOR.
 * El cliente recibe las preguntas sin solución y envía sus respuestas;
 * el estado, la nota y el certificado los fija /api/publico/curso/intento.
 */

type Centro = { id: string; nombre: string };
type Pantalla = "landing" | "course" | "exam-intro" | "exam" | "result";
type Pregunta = { id: number; q: string; options: string[] };
type Resultado = {
  aciertos: number;
  total: number;
  aprobado: boolean;
  codigo_certificado: string | null;
  puede_reintentar: boolean;
};

const PUESTOS = [
  "Cocina",
  "Sala / Camarero",
  "Barra / Bartender",
  "Producción",
  "Tienda / Visitas",
  "Limpieza",
  "Mantenimiento",
  "Responsable / Encargado",
  "Otro",
];

export default function FormacionApp({ centros }: { centros: Centro[] }) {
  const [pantalla, setPantalla] = useState<Pantalla>("landing");
  const [inscripcionId, setInscripcionId] = useState<string | null>(null);
  const [alta, setAlta] = useState({
    nombre: "",
    apellidos: "",
    dni: "",
    email: "",
    telefono: "",
    centro_id: "",
    puesto: "",
    rgpd: false,
  });
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const [moduloActual, setModuloActual] = useState(0);
  const [completados, setCompletados] = useState<number[]>([]);

  const [preguntas, setPreguntas] = useState<Pregunta[]>([]);
  const [numIntento, setNumIntento] = useState(0);
  const [respuestas, setRespuestas] = useState<(string | null)[]>([]);
  const [preguntaActual, setPreguntaActual] = useState(0);
  const inicioExamen = useRef(0);

  const [resultado, setResultado] = useState<Resultado | null>(null);

  const centroNombre = useMemo(
    () => centros.find((c) => c.id === alta.centro_id)?.nombre ?? "",
    [centros, alta.centro_id]
  );

  // ---- barra de progreso superior ----
  const progreso = useMemo(() => {
    if (pantalla === "landing") return { pct: 0, label: "Inicio" };
    if (pantalla === "course")
      return {
        pct: ((moduloActual + 1) / (MODULOS.length + 1)) * 80,
        label: `Módulo ${moduloActual + 1} de ${MODULOS.length}`,
      };
    if (pantalla === "exam-intro") return { pct: 85, label: "Antes del examen" };
    if (pantalla === "exam")
      return {
        pct: 85 + (preguntaActual / Math.max(preguntas.length, 1)) * 10,
        label: `Examen · Pregunta ${preguntaActual + 1}`,
      };
    return { pct: 100, label: "Finalizado" };
  }, [pantalla, moduloActual, preguntaActual, preguntas.length]);

  function subir() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---- registro ----
  async function registrar() {
    setError("");
    if (
      !alta.nombre.trim() ||
      !alta.apellidos.trim() ||
      !alta.dni.trim() ||
      !alta.email.trim() ||
      !alta.telefono.trim() ||
      !alta.centro_id ||
      !alta.puesto
    ) {
      setError("Por favor completa todos los campos obligatorios.");
      return;
    }
    if (!/^[A-Z0-9]{8,9}[A-Z]$/i.test(alta.dni.trim())) {
      setError("El DNI/NIE no parece válido.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alta.email.trim())) {
      setError("El email no parece válido.");
      return;
    }
    if (!alta.rgpd) {
      setError("Debes aceptar el tratamiento de datos para continuar.");
      return;
    }
    setOcupado(true);
    try {
      const res = await fetch("/api/publico/curso/inscribir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...alta, dni: alta.dni.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "error");
      setInscripcionId(data.inscripcion_id);
      setModuloActual(0);
      setPantalla("course");
      subir();
    } catch {
      setError("Error al registrar. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  // ---- curso ----
  function irAModulo(i: number) {
    setModuloActual(i);
    subir();
  }
  function completarModulo(i: number) {
    setCompletados((prev) => (prev.includes(i) ? prev : [...prev, i]));
  }

  // ---- examen ----
  async function empezarExamen() {
    setError("");
    setOcupado(true);
    try {
      const res = await fetch("/api/publico/curso/examen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inscripcion_id: inscripcionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "error");
      setPreguntas(data.preguntas);
      setNumIntento(data.intento);
      setRespuestas(new Array(data.preguntas.length).fill(null));
      setPreguntaActual(0);
      inicioExamen.current = Date.now();
      setPantalla("exam");
      subir();
    } catch {
      setError("No se ha podido generar el examen. Inténtalo de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  function responder(opcion: string) {
    setRespuestas((prev) => {
      const s = [...prev];
      s[preguntaActual] = opcion;
      return s;
    });
  }

  async function finalizarExamen() {
    if (respuestas.includes(null)) return;
    setOcupado(true);
    try {
      const res = await fetch("/api/publico/curso/intento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inscripcion_id: inscripcionId,
          respuestas: preguntas.map((p, i) => ({ id: p.id, respuesta: respuestas[i] })),
          duracion_segundos: Math.floor((Date.now() - inicioExamen.current) / 1000),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "error");
      setResultado(data);
      setPantalla("result");
      subir();
    } catch {
      setError("No se ha podido entregar el examen. Inténtalo de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  // ---- certificado PDF (solo presentación: el código lo emitió el servidor) ----
  async function descargarCertificado() {
    if (!resultado?.codigo_certificado) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const W = 297;
    const H = 210;
    const cream: [number, number, number] = [245, 240, 230];
    const ink: [number, number, number] = [26, 35, 50];
    const terracotta: [number, number, number] = [196, 89, 58];
    const gold: [number, number, number] = [200, 155, 74];

    doc.setFillColor(...cream);
    doc.rect(0, 0, W, H, "F");
    doc.setDrawColor(...ink);
    doc.setLineWidth(1.2);
    doc.rect(10, 10, W - 20, H - 20);
    doc.setLineWidth(0.3);
    doc.rect(13, 13, W - 26, H - 26);
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.5);
    doc.line(13, 25, 25, 25);
    doc.line(25, 13, 25, 25);
    doc.line(W - 13, 25, W - 25, 25);
    doc.line(W - 25, 13, W - 25, 25);
    doc.line(13, H - 25, 25, H - 25);
    doc.line(25, H - 13, 25, H - 25);
    doc.line(W - 13, H - 25, W - 25, H - 25);
    doc.line(W - 25, H - 13, W - 25, H - 25);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...ink);
    doc.text("BONITA MENORCA SL · ESPAÑA", W / 2, 28, { align: "center" });
    doc.setDrawColor(...terracotta);
    doc.setLineWidth(0.4);
    doc.line(W / 2 - 25, 32, W / 2 + 25, 32);
    doc.setFont("times", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...terracotta);
    doc.text("FORMACIÓN OBLIGATORIA", W / 2, 45, { align: "center" });
    doc.setFont("times", "italic");
    doc.setFontSize(34);
    doc.setTextColor(...ink);
    doc.text("Certificado de Manipulador", W / 2, 62, { align: "center" });
    doc.text("de Alimentos", W / 2, 76, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(60, 70, 90);
    doc.text("Se certifica que", W / 2, 95, { align: "center" });
    doc.setFont("times", "italic");
    doc.setFontSize(26);
    doc.setTextColor(...ink);
    doc.text(`${alta.nombre} ${alta.apellidos}`, W / 2, 108, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(60, 70, 90);
    doc.text(`con DNI/NIE ${alta.dni.toUpperCase()}`, W / 2, 116, { align: "center" });
    doc.setFontSize(11);
    doc.setTextColor(40, 50, 70);
    [
      "ha completado satisfactoriamente la formación interna en higiene y seguridad alimentaria,",
      "conforme al Reglamento (CE) 852/2004, RD 1021/2022 y Reglamento (UE) 1169/2011 sobre alérgenos.",
      `Centro de trabajo: ${centroNombre} · Puesto: ${alta.puesto}`,
    ].forEach((linea, i) => doc.text(linea, W / 2, 128 + i * 6, { align: "center" }));
    const fechaStr = new Date().toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...ink);
    doc.text(`Menorca, ${fechaStr}`, W / 2, 152, { align: "center" });
    doc.setDrawColor(...ink);
    doc.setLineWidth(0.3);
    doc.line(W / 2 - 35, 168, W / 2 + 35, 168);
    doc.setFont("times", "italic");
    doc.setFontSize(11);
    doc.text("Bonita Menorca SL", W / 2, 175, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80, 90, 110);
    doc.text(
      "Empresa alimentaria responsable de la formación · Art. 4.2 Reglamento (CE) 852/2004",
      W / 2,
      180,
      { align: "center" }
    );
    doc.setFontSize(8);
    doc.setTextColor(...gold);
    doc.text(`Código de certificado: ${resultado.codigo_certificado}`, 22, H - 20);
    doc.setTextColor(80, 90, 110);
    doc.text("Validez recomendada: 4 años desde la fecha de emisión.", W - 22, H - 20, {
      align: "right",
    });
    doc.save(`Certificado_Manipulador_${alta.apellidos}_${alta.nombre}.pdf`);
  }

  // ================= render =================
  const m = MODULOS[moduloActual];
  const esUltimo = moduloActual === MODULOS.length - 1;
  const q = preguntas[preguntaActual];

  return (
    <div className="curso-app">
      <div className="app">
        <div className="top-bar">
          <div className="brand">
            Bonita Menorca <em>·</em> Formación de Manipulador de Alimentos
          </div>
          <div className="progress-mini">{progreso.label}</div>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progreso.pct}%` }} />
        </div>

        {/* ---- LANDING + REGISTRO ---- */}
        {pantalla === "landing" && (
          <div className="screen active">
            <div className="landing">
              <div className="landing-hero">
                <div
                  style={{
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: "0.2em",
                    color: "var(--terracotta)",
                    marginBottom: 24,
                    fontWeight: 600,
                  }}
                >
                  Formación obligatoria · {new Date().getFullYear()}
                </div>
                <h1>
                  Higiene y seguridad alimentaria <em>según la normativa vigente</em>
                </h1>
                <p className="lead">
                  Curso interno de Bonita Menorca para todo el personal en contacto con
                  alimentos. Adaptado al RD 1021/2022 y al Reglamento (CE) 852/2004.
                </p>
                <div className="landing-meta">
                  <div className="meta-item">
                    <div className="label">Duración</div>
                    <div className="value">~2 horas</div>
                  </div>
                  <div className="meta-item">
                    <div className="label">Módulos</div>
                    <div className="value">{MODULOS.length}</div>
                  </div>
                  <div className="meta-item">
                    <div className="label">Examen</div>
                    <div className="value">20 preguntas</div>
                  </div>
                </div>
                <div className="legal-note">
                  <strong>Validez legal.</strong> Bonita Menorca SL, como operador de
                  empresa alimentaria, es responsable de la formación de sus manipuladores
                  conforme al art. 4.2 del Reglamento (CE) 852/2004. El certificado
                  emitido al finalizar este curso acredita dicha formación ante una
                  inspección de Sanidad.
                </div>
              </div>

              <div className="register-card">
                <h2>Comenzar el curso</h2>
                <p className="subtitle">Introduce tus datos para registrar tu formación.</p>
                {error && <div className="alert error">{error}</div>}
                <form onSubmit={(e) => e.preventDefault()}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>
                        Nombre <span className="req">*</span>
                      </label>
                      <input
                        type="text"
                        value={alta.nombre}
                        onChange={(e) => setAlta({ ...alta, nombre: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>
                        Apellidos <span className="req">*</span>
                      </label>
                      <input
                        type="text"
                        value={alta.apellidos}
                        onChange={(e) => setAlta({ ...alta, apellidos: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>
                      DNI / NIE <span className="req">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="12345678X"
                      value={alta.dni}
                      onChange={(e) => setAlta({ ...alta, dni: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>
                        Email <span className="req">*</span>
                      </label>
                      <input
                        type="email"
                        value={alta.email}
                        onChange={(e) => setAlta({ ...alta, email: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>
                        Teléfono <span className="req">*</span>
                      </label>
                      <input
                        type="tel"
                        placeholder="600 000 000"
                        value={alta.telefono}
                        onChange={(e) => setAlta({ ...alta, telefono: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>
                        Centro de trabajo <span className="req">*</span>
                      </label>
                      <select
                        value={alta.centro_id}
                        onChange={(e) => setAlta({ ...alta, centro_id: e.target.value })}
                      >
                        <option value="">Selecciona...</option>
                        {centros.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>
                        Puesto <span className="req">*</span>
                      </label>
                      <select
                        value={alta.puesto}
                        onChange={(e) => setAlta({ ...alta, puesto: e.target.value })}
                      >
                        <option value="">Selecciona...</option>
                        {PUESTOS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="checkbox-row">
                    <input
                      type="checkbox"
                      id="reg-rgpd"
                      checked={alta.rgpd}
                      onChange={(e) => setAlta({ ...alta, rgpd: e.target.checked })}
                    />
                    <label htmlFor="reg-rgpd">
                      He leído y acepto que Bonita Menorca SL trate mis datos personales
                      con la finalidad de gestionar mi formación obligatoria como
                      manipulador de alimentos, conforme al RGPD. Los datos se conservarán
                      durante el período legalmente requerido para acreditar la formación
                      ante inspecciones sanitarias.
                    </label>
                  </div>
                  <button
                    className="btn btn-primary"
                    disabled={ocupado}
                    onClick={registrar}
                  >
                    {ocupado ? "Registrando..." : "Comenzar curso →"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* ---- CURSO ---- */}
        {pantalla === "course" && (
          <div className="screen active">
            <div className="course">
              <aside className="sidebar">
                <h3>Programa</h3>
                <ul className="module-list">
                  {MODULOS.map((mod, i) => (
                    <li
                      key={mod.id}
                      className={`${i === moduloActual ? "active" : ""} ${
                        completados.includes(i) ? "completed" : ""
                      }`}
                      onClick={() => irAModulo(i)}
                    >
                      <div className="num">{completados.includes(i) ? "✓" : mod.id}</div>
                      <div className="title">{mod.title}</div>
                    </li>
                  ))}
                </ul>
              </aside>
              <main className="course-content">
                <div className="module-header">
                  <div className="module-eyebrow">{m.eyebrow}</div>
                  <h1>{m.title}</h1>
                  <p className="description">{m.description}</p>
                </div>
                <div dangerouslySetInnerHTML={{ __html: m.content }} />
                <div className="module-nav">
                  {moduloActual > 0 ? (
                    <button
                      className="btn btn-secondary"
                      onClick={() => irAModulo(moduloActual - 1)}
                    >
                      ← Módulo anterior
                    </button>
                  ) : (
                    <div />
                  )}
                  {!esUltimo ? (
                    <button
                      className="btn btn-primary"
                      style={{ width: "auto" }}
                      onClick={() => {
                        completarModulo(moduloActual);
                        irAModulo(moduloActual + 1);
                      }}
                    >
                      Siguiente módulo →
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary"
                      style={{ width: "auto" }}
                      onClick={() => {
                        completarModulo(moduloActual);
                        setPantalla("exam-intro");
                        subir();
                      }}
                    >
                      Ir al examen final →
                    </button>
                  )}
                </div>
              </main>
            </div>
          </div>
        )}

        {/* ---- INTRO EXAMEN ---- */}
        {pantalla === "exam-intro" && (
          <div className="screen active">
            <div className="exam-intro">
              <div className="eyebrow">Evaluación final</div>
              <h1>
                Examen de manipulador
                <br />
                <em style={{ fontStyle: "italic", color: "var(--terracotta)" }}>
                  de alimentos
                </em>
              </h1>
              <p className="lead">
                Demuestra los conocimientos adquiridos. Necesitas{" "}
                <strong>15 respuestas correctas de 20</strong> para aprobar y obtener el
                certificado.
              </p>
              <div className="exam-stats">
                <div className="exam-stat">
                  <div className="num">20</div>
                  <div className="lbl">Preguntas</div>
                </div>
                <div className="exam-stat">
                  <div className="num">15</div>
                  <div className="lbl">Para aprobar</div>
                </div>
                <div className="exam-stat">
                  <div className="num">3</div>
                  <div className="lbl">Intentos</div>
                </div>
                <div className="exam-stat">
                  <div className="num">∞</div>
                  <div className="lbl">Tiempo</div>
                </div>
              </div>
              {error && (
                <div className="alert error" style={{ marginTop: 24 }}>
                  {error}
                </div>
              )}
              <div style={{ marginTop: 32 }}>
                <button
                  className="btn btn-primary"
                  style={{ maxWidth: 320 }}
                  disabled={ocupado}
                  onClick={empezarExamen}
                >
                  {ocupado ? "Preparando..." : "Comenzar examen →"}
                </button>
                <div style={{ marginTop: 16 }}>
                  <button className="btn btn-ghost" onClick={() => setPantalla("course")}>
                    ← Volver al temario
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---- EXAMEN ---- */}
        {pantalla === "exam" && q && (
          <div className="screen active">
            <div className="exam-screen">
              <div className="question-counter">
                <div className="num">
                  Pregunta <em>{preguntaActual + 1}</em> / {preguntas.length}
                </div>
                <div className="timer">
                  Intento {numIntento} de 3
                </div>
              </div>
              <div className="question">
                <h2>{q.q}</h2>
                <ul className="answer-list">
                  {q.options.map((opt, idx) => (
                    <li
                      key={idx}
                      className={`answer-option ${
                        respuestas[preguntaActual] === opt ? "selected" : ""
                      }`}
                      onClick={() => responder(opt)}
                    >
                      <div className="marker">{String.fromCharCode(65 + idx)}</div>
                      <div className="text">{opt}</div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="module-nav">
                {preguntaActual > 0 ? (
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setPreguntaActual(preguntaActual - 1);
                      subir();
                    }}
                  >
                    ← Anterior
                  </button>
                ) : (
                  <div />
                )}
                {preguntaActual < preguntas.length - 1 ? (
                  <button
                    className="btn btn-primary"
                    style={{ width: "auto" }}
                    disabled={respuestas[preguntaActual] === null}
                    onClick={() => {
                      setPreguntaActual(preguntaActual + 1);
                      subir();
                    }}
                  >
                    Siguiente →
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    style={{ width: "auto" }}
                    disabled={respuestas.includes(null) || ocupado}
                    onClick={finalizarExamen}
                  >
                    {ocupado ? "Corrigiendo..." : "Finalizar examen"}
                  </button>
                )}
              </div>
              {error && (
                <div className="alert error" style={{ marginTop: 24 }}>
                  {error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---- RESULTADO ---- */}
        {pantalla === "result" && resultado && (
          <div className="screen active">
            <div className={`result ${resultado.aprobado ? "pass" : "fail"}`}>
              {resultado.aprobado ? (
                <>
                  <div className="verdict-icon">✓</div>
                  <div className="eyebrow">Aprobado</div>
                  <h1>¡Enhorabuena, {alta.nombre}!</h1>
                  <p
                    className="lead"
                    style={{
                      fontSize: 17,
                      color: "var(--ink-soft)",
                      margin: "16px auto 0",
                      maxWidth: 480,
                    }}
                  >
                    Has superado la formación de manipulador de alimentos. Descarga tu
                    certificado a continuación.
                  </p>
                  <div className="score-display">
                    {resultado.aciertos}
                    <span className="total">/{resultado.total}</span>
                  </div>
                  <div
                    style={{
                      marginBottom: 24,
                      padding: "16px 24px",
                      background: "var(--cream-soft)",
                      borderRadius: 3,
                      display: "inline-block",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--ink-soft)",
                        marginBottom: 4,
                      }}
                    >
                      Código de certificado
                    </div>
                    <div
                      style={{
                        fontFamily: "'Fraunces', serif",
                        fontSize: 22,
                        fontWeight: 500,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {resultado.codigo_certificado}
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      className="btn btn-primary"
                      style={{ maxWidth: 280 }}
                      onClick={descargarCertificado}
                    >
                      ⬇ Descargar certificado
                    </button>
                  </div>
                  <p style={{ marginTop: 32, fontSize: 13, color: "var(--ink-soft)" }}>
                    Conserva este certificado. Bonita Menorca SL guarda también una copia
                    en el archivo de formación de personal a efectos de inspección
                    sanitaria.
                  </p>
                </>
              ) : (
                <>
                  <div className="verdict-icon">✗</div>
                  <div className="eyebrow">No superado</div>
                  <h1>
                    {resultado.puede_reintentar ? "Sigue intentándolo" : "Examen no superado"}
                  </h1>
                  <p
                    className="lead"
                    style={{
                      fontSize: 17,
                      color: "var(--ink-soft)",
                      margin: "16px auto 0",
                      maxWidth: 520,
                    }}
                  >
                    {resultado.puede_reintentar
                      ? `Necesitas 15 aciertos para aprobar. Te quedan ${
                          3 - numIntento
                        } intento(s). Repasa el material antes de volver a intentarlo.`
                      : "Has agotado los 3 intentos disponibles. Contacta con tu responsable para reanudar la formación."}
                  </p>
                  <div className="score-display">
                    {resultado.aciertos}
                    <span className="total">/{resultado.total}</span>
                  </div>
                  {resultado.puede_reintentar && (
                    <div className="actions">
                      <button
                        className="btn btn-primary"
                        style={{ maxWidth: 280 }}
                        onClick={() => {
                          setPantalla("course");
                          setModuloActual(0);
                          subir();
                        }}
                      >
                        Repasar material
                      </button>
                      <button className="btn btn-secondary" onClick={empezarExamen}>
                        Reintentar examen
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
