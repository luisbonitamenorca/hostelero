"use client";

export default function ErrorGlobal({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="pantalla-login">
      <div className="caja-login">
        <p style={{ margin: "0 0 16px", color: "var(--gris)" }}>
          Algo ha fallado al cargar esta pantalla. Suele bastar con volver a
          intentarlo.
        </p>
        <button className="boton" onClick={() => reset()}>Reintentar</button>
      </div>
    </main>
  );
}
