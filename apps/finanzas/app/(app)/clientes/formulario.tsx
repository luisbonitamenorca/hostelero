"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { guardarCliente, type EstadoAccion } from "../../acciones";
import { errorDeIban, errorDeNif, formatearIban } from "@/lib/nif";
import { TIPOS_IVA } from "@/lib/constantes";

export type ClienteFicha = {
  id: string;
  nif: string | null;
  nombre_fiscal: string;
  nombre_comercial: string | null;
  direccion: string | null;
  codigo_postal: string | null;
  municipio: string | null;
  provincia: string | null;
  pais: string;
  email: string | null;
  telefono: string | null;
  iban: string | null;
  dias_vencimiento: number;
  tipo_iva_defecto: number;
  retencion_pct: number;
  notas: string | null;
  activo: boolean;
};

export default function FormularioCliente({ cliente }: { cliente?: ClienteFicha }) {
  const router = useRouter();
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(guardarCliente, null);

  useEffect(() => {
    if (estado?.ok && estado.ir) {
      router.push(estado.ir);
      router.refresh();
    }
  }, [estado, router]);

  // Aviso inmediato mientras se escribe. La validación que manda es la del
  // servidor, en acciones.ts: esta solo evita el viaje de ida y vuelta.
  const [pais, setPais] = useState(cliente?.pais ?? "ES");
  const [nif, setNif] = useState(cliente?.nif ?? "");
  const [iban, setIban] = useState(cliente?.iban ? formatearIban(cliente.iban) : "");

  const avisoNif = pais === "ES" && nif.trim() ? errorDeNif(nif) : null;
  const avisoIban = iban.trim() ? errorDeIban(iban) : null;

  return (
    <form className="formulario" action={accion} noValidate>
      {cliente && <input type="hidden" name="id" value={cliente.id} />}

      <fieldset className="bloque">
        <legend>Identificación</legend>
        <div className="rejilla">
          <label className="campo ancho-2">
            <span>Nombre fiscal *</span>
            <input name="nombre_fiscal" defaultValue={cliente?.nombre_fiscal ?? ""} required autoFocus />
          </label>
          <label className="campo ancho-2">
            <span>Nombre comercial</span>
            <input name="nombre_comercial" defaultValue={cliente?.nombre_comercial ?? ""} />
          </label>
          <label className="campo">
            <span>NIF {pais === "ES" ? "*" : "(según su país)"}</span>
            <input
              className="dato"
              name="nif"
              value={nif}
              onChange={(e) => setNif(e.target.value.toUpperCase())}
              aria-invalid={!!avisoNif}
              placeholder="B01996826"
            />
            {avisoNif && <em className="error-campo">{avisoNif}</em>}
          </label>
          <label className="campo">
            <span>País</span>
            <input
              className="dato"
              name="pais"
              value={pais}
              onChange={(e) => setPais(e.target.value.toUpperCase().slice(0, 2))}
              maxLength={2}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="bloque">
        <legend>Domicilio fiscal</legend>
        <div className="rejilla">
          <label className="campo ancho-4">
            <span>Dirección</span>
            <input name="direccion" defaultValue={cliente?.direccion ?? ""} />
          </label>
          <label className="campo">
            <span>Código postal</span>
            <input className="dato" name="codigo_postal" defaultValue={cliente?.codigo_postal ?? ""} maxLength={10} />
          </label>
          <label className="campo">
            <span>Municipio</span>
            <input name="municipio" defaultValue={cliente?.municipio ?? ""} />
          </label>
          <label className="campo ancho-2">
            <span>Provincia</span>
            <input name="provincia" defaultValue={cliente?.provincia ?? ""} />
          </label>
        </div>
      </fieldset>

      <fieldset className="bloque">
        <legend>Contacto</legend>
        <div className="rejilla">
          <label className="campo ancho-2">
            <span>Correo</span>
            <input type="email" name="email" defaultValue={cliente?.email ?? ""} />
          </label>
          <label className="campo ancho-2">
            <span>Teléfono</span>
            <input name="telefono" defaultValue={cliente?.telefono ?? ""} />
          </label>
        </div>
      </fieldset>

      <fieldset className="bloque">
        <legend>Condiciones de facturación</legend>
        <div className="rejilla">
          <label className="campo ancho-2">
            <span>IBAN</span>
            <input
              className="dato"
              name="iban"
              value={iban}
              onChange={(e) => setIban(e.target.value.toUpperCase())}
              onBlur={() => iban.trim() && setIban(formatearIban(iban))}
              aria-invalid={!!avisoIban}
              placeholder="ES91 2100 0418 4502 0005 1332"
            />
            {avisoIban ? (
              <em className="error-campo">{avisoIban}</em>
            ) : (
              <em className="pista">Necesario solo si se le va a cobrar por remesa SEPA.</em>
            )}
          </label>
          <label className="campo">
            <span>Días de vencimiento</span>
            <input
              className="dato"
              type="number"
              name="dias_vencimiento"
              min={0}
              max={365}
              defaultValue={cliente?.dias_vencimiento ?? 0}
            />
          </label>
          <label className="campo">
            <span>IVA por defecto</span>
            <select className="dato" name="tipo_iva_defecto" defaultValue={String(Number(cliente?.tipo_iva_defecto ?? 21))}>
              {TIPOS_IVA.map((t) => (
                <option key={t} value={String(t)}>
                  {t} %
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Retención</span>
            <input
              className="dato"
              type="number"
              name="retencion_pct"
              min={0}
              max={100}
              step="0.01"
              defaultValue={Number(cliente?.retencion_pct ?? 0)}
            />
            <em className="pista">% de IRPF. Deja 0 si no procede.</em>
          </label>
        </div>
      </fieldset>

      <fieldset className="bloque">
        <legend>Otros</legend>
        <div className="rejilla">
          <label className="campo ancho-4">
            <span>Notas</span>
            <textarea name="notas" rows={3} defaultValue={cliente?.notas ?? ""} />
          </label>
        </div>
        <label className="casilla">
          <input type="checkbox" name="activo" defaultChecked={cliente?.activo ?? true} />
          <span>Cliente activo</span>
        </label>
        <p className="pista">
          Los clientes inactivos no se ofrecen al crear facturas, pero sus facturas anteriores se
          conservan intactas.
        </p>
      </fieldset>

      {estado?.error && <p className="error-texto">{estado.error}</p>}

      <div className="acciones">
        <button className="boton boton-auto" type="submit" disabled={pendiente || estado?.ok}>
          {pendiente || estado?.ok ? "Guardando…" : cliente ? "Guardar cambios" : "Crear cliente"}
        </button>
        <Link className="boton-secundario" href="/clientes">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
