export const dynamic = "force-dynamic";

/** El front público de Visitas, embebido en el backoffice para reservar como un cliente. */
export default function FrontVisitas() {
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Front público</h2>
          <p>La misma página que ve el cliente (/reservar). Lo que reserves aquí es real: cancélalo después desde Reservas.</p>
        </div>
        <a className="btn" href="/reservar" target="_blank" rel="noopener noreferrer">Abrir en pestaña nueva ↗</a>
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <iframe
          src="/reservar"
          title="Front público de Visitas"
          style={{ width: "100%", height: "calc(100vh - 240px)", minHeight: 600, border: 0, display: "block" }}
        />
      </div>
    </>
  );
}
