import Link from "next/link";

export default function NoEncontrado() {
  return (
    <main className="pantalla-login">
      <div className="caja-login">
        <p style={{ margin: "0 0 16px", color: "var(--gris)" }}>
          Esta página no existe o la cuenta que buscas ya no está.
        </p>
        <Link href="/" className="boton-enlace">Volver a cuentas</Link>
      </div>
    </main>
  );
}
