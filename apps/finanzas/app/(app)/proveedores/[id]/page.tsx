import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirModulo } from "@/lib/supabase/server";
import { euros } from "@/lib/importes";
import { paginarEnParalelo } from "@/lib/paginar";
import FormularioProveedor from "./formulario-proveedor";

export const dynamic = "force-dynamic";

/**
 * Ficha del proveedor (13-10-2026, Luis). Arriba, lo que es del maestro de
 * Compras y aquí solo se consulta (nombre, NIF, cuentas, departamento por
 * defecto…); debajo, lo que es de Contabilidad y se edita aquí: forma y plazo
 * de pago, cuenta bancaria, contacto y observaciones.
 */
export default async function FichaProveedor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string }>;
}) {
  const { id } = await params;
  const { aviso } = await searchParams;
  const { supabase } = await exigirModulo("compras");

  const [{ data: p }, { data: cond }, { filas: docs }] = await Promise.all([
    supabase
      .from("compras_proveedor")
      .select("id, nombre, nif, categoria, cuenta_contable, cuenta_proveedor, departamento, critico, codigo_a3, regimen_iva, retencion_modelo, retencion_pct, pedido_email, pedido_telefono")
      .eq("id", id)
      .maybeSingle(),
    // select('*') a propósito: si la migración de contacto no está aplicada, vienen las columnas que haya.
    supabase.from("fin_proveedor_condiciones").select("*").eq("proveedor_id", id).maybeSingle(),
    paginarEnParalelo<{ total: number | null }>((d, h, contar) =>
      supabase
        .from("compras_doc")
        .select("total", contar ? { count: "exact" } : undefined)
        .eq("tipo", "factura")
        .eq("proveedor_id", id)
        .order("id")
        .range(d, h),
    ),
  ]);

  if (!p) notFound();

  const nFacturas = docs.length;
  const facturado = docs.reduce((s, d) => s + Number(d.total ?? 0), 0);

  const dato = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : String(v));

  return (
    <>
      <div className="cabecera-pagina con-accion">
        <div>
          <p className="miga">
            <Link className="enlace" href="/proveedores">
              Proveedores
            </Link>{" "}
            / Ficha
          </p>
          <h1>
            {p.nombre}
            {p.critico && <span className="etiqueta-estado">crítico</span>}
          </h1>
          <p className="sub">
            {nFacturas} factura{nFacturas === 1 ? "" : "s"} · {euros(facturado)} facturado.
          </p>
        </div>
        {p.cuenta_proveedor && (
          <Link className="boton-secundario boton-auto" href={`/mayor?cuenta=${p.cuenta_proveedor}`}>
            Ver su mayor ({p.cuenta_proveedor})
          </Link>
        )}
      </div>

      {aviso === "contacto" && (
        <p className="aviso-texto">
          Se guardaron pago y observaciones. Teléfono, correo y persona de contacto necesitan la migración
          20261013130000 en la base.
        </p>
      )}

      <div className="formulario">
        <fieldset className="bloque">
          <legend>Datos del maestro (módulo de Compras)</legend>
          <div className="rejilla">
            <div className="campo">
              <span>NIF</span>
              <p className="dato">{dato(p.nif)}</p>
            </div>
            <div className="campo">
              <span>Categoría</span>
              <p>{dato(p.categoria)}</p>
            </div>
            <div className="campo ancho-2">
              <span>Departamento por defecto</span>
              <p>{dato(p.departamento)}</p>
            </div>
            <div className="campo">
              <span>Cuenta de gasto</span>
              <p className="dato">{dato(p.cuenta_contable)}</p>
            </div>
            <div className="campo">
              <span>Cuenta de proveedor</span>
              <p className="dato">{dato(p.cuenta_proveedor)}</p>
            </div>
            <div className="campo">
              <span>Código A3</span>
              <p className="dato">{dato(p.codigo_a3)}</p>
            </div>
            <div className="campo">
              <span>Régimen de IVA</span>
              <p className="dato">{dato(p.regimen_iva)}</p>
            </div>
            <div className="campo">
              <span>Retención</span>
              <p className="dato">{p.retencion_pct != null ? `${p.retencion_pct} %${p.retencion_modelo ? ` · modelo ${p.retencion_modelo}` : ""}` : "—"}</p>
            </div>
            <div className="campo ancho-3" style={{ gridColumn: "span 3" }}>
              <span>Contacto de pedidos (Compras)</span>
              <p>{[p.pedido_email, p.pedido_telefono].filter(Boolean).join(" · ") || "—"}</p>
            </div>
          </div>
          <p className="pista">
            Estos datos se editan en el módulo de Compras, en su pestaña Proveedores: aquí solo se consultan.{" "}
            <a className="enlace" href="/compras">
              Abrir Compras
            </a>
          </p>
        </fieldset>

        <FormularioProveedor proveedorId={p.id} cond={cond as Parameters<typeof FormularioProveedor>[0]["cond"]} />
      </div>
    </>
  );
}
