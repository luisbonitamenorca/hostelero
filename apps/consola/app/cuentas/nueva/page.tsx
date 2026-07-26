import Link from "next/link";
import { exigirOperador } from "@/lib/supabase/server";
import { crearCuenta } from "../../acciones";

export const dynamic = "force-dynamic";

const ERRORES: Record<string, string> = {
  nombre: "El nombre de la cuenta es obligatorio.",
  guardar: "No se ha podido guardar la cuenta. Vuelve a intentarlo.",
};

export default async function NuevaCuenta({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await exigirOperador();
  const { error } = await searchParams;

  return (
    <>
      <header className="cabecera">
        <div className="cabecera-interior">
          <div>
            <span className="marca">Consola Hostelero</span>
            <span className="etiqueta-interno">Interno</span>
          </div>
        </div>
      </header>

      <main className="contenido">
        <Link href="/" className="migas">← Cuentas</Link>
        <h1 className="titulo">Nueva cuenta</h1>
        <p className="subtitulo">El cliente que contrata Hostelero</p>

        {error && ERRORES[error] && <p className="aviso-error">{ERRORES[error]}</p>}

        <div className="tarjeta">
          <form action={crearCuenta} className="formulario">
            <div className="campo">
              <label htmlFor="nombre">Nombre</label>
              <input id="nombre" name="nombre" type="text" required placeholder="Restaurant Es Molí" />
            </div>
            <div className="campo">
              <label htmlFor="plan">Plan</label>
              <select id="plan" name="plan" defaultValue="basico">
                <option value="basico">Básico</option>
                <option value="operaciones">Operaciones</option>
                <option value="completo">Completo</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor="estado">Estado</label>
              <select id="estado" name="estado" defaultValue="en_pruebas">
                <option value="en_pruebas">En pruebas</option>
                <option value="activa">Activa</option>
              </select>
            </div>
            <button className="boton" type="submit">Crear cuenta</button>
          </form>
        </div>

        <p style={{ fontSize: 13, color: "var(--gris-claro)" }}>
          Las sociedades y los centros se añaden desde la ficha de la cuenta en la
          siguiente iteración; de momento se crean desde Supabase.
        </p>
      </main>
    </>
  );
}
