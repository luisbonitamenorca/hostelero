import QRCode from "qrcode";
import { euros, fecha, numero } from "@/lib/importes";
import BotonAnular from "./boton-anular";
import { ruta } from "@/lib/rutas.ts";

type Linea = {
  orden: number;
  concepto: string;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  tipo_iva: number;
  tipo_retencion: number;
  base: number;
  cuota_iva: number;
};

type Impuesto = { impuesto: string; tipo_pct: number; base: number; cuota: number };

type Registro = {
  tipo_registro: string;
  orden: number;
  huella: string;
  huella_anterior: string | null;
  fecha_hora_registro: string;
  payload: { qr?: string; cadena?: string; motivo?: string } | null;
};

export type FacturaExpedida = {
  id: string;
  numero_completo: string | null;
  tipo: string;
  estado: string;
  fecha_expedicion: string | null;
  fecha_operacion: string | null;
  descripcion_operacion: string | null;
  base_total: number;
  cuota_iva_total: number;
  cuota_retencion: number;
  total: number;
  cliente: { nombre_fiscal: string; nif: string | null; direccion: string | null; codigo_postal: string | null; municipio: string | null; provincia: string | null } | null;
  lineas: Linea[];
  impuestos: Impuesto[];
  registros: Registro[];
  envio: { estado: string; csv_aeat: string | null; intento: number } | null;
};

const ESTADO_ENVIO: Record<string, string> = {
  pendiente: "pendiente de remitir a la AEAT",
  enviando: "enviándose a la AEAT",
  aceptado: "aceptado por la AEAT",
  aceptado_errores: "aceptado con errores por la AEAT",
  rechazado: "rechazado por la AEAT",
  error: "error al remitir",
};

export default async function DetalleFactura({ factura }: { factura: FacturaExpedida }) {
  const alta = factura.registros.find((r) => r.tipo_registro === "alta");
  const anulacion = factura.registros.find((r) => r.tipo_registro === "anulacion");
  const contenidoQr = alta?.payload?.qr ?? null;

  // Nivel M de corrección de errores: lo exige el artículo 21 de la orden.
  const qrSvg = contenidoQr
    ? await QRCode.toString(contenidoQr, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        width: 160,
      })
    : null;

  // El importe del registro (y del QR) NO resta la retención; el total a pagar sí.
  const totalFactura = factura.base_total + factura.cuota_iva_total;
  const hayRetencion = factura.cuota_retencion > 0;

  return (
    <>
      {factura.estado === "anulada" && (
        <div className="aviso-banda">
          <strong>Factura anulada.</strong> Se conserva íntegra: la anulación es un registro más de
          la cadena, no un borrado.
          {anulacion?.payload?.motivo && <> Motivo: {anulacion.payload.motivo}</>}
        </div>
      )}

      <div className="bloque">
        <div className="rejilla">
          <div className="campo">
            <span>Número</span>
            <p className="dato valor">{factura.numero_completo}</p>
          </div>
          <div className="campo">
            <span>Tipo</span>
            <p className="valor">{factura.tipo}</p>
          </div>
          <div className="campo">
            <span>Fecha de expedición</span>
            <p className="dato valor">{fecha(factura.fecha_expedicion)}</p>
          </div>
          <div className="campo">
            <span>Fecha de operación</span>
            <p className="dato valor">{fecha(factura.fecha_operacion)}</p>
          </div>
          <div className="campo ancho-2">
            <span>Cliente</span>
            <p className="valor">{factura.cliente?.nombre_fiscal ?? "—"}</p>
            {factura.cliente && (
              <p className="detalle">
                {factura.cliente.nif ?? "sin NIF"}
                {factura.cliente.direccion && ` · ${factura.cliente.direccion}`}
                {factura.cliente.codigo_postal && `, ${factura.cliente.codigo_postal}`}
                {factura.cliente.municipio && ` ${factura.cliente.municipio}`}
                {factura.cliente.provincia && ` (${factura.cliente.provincia})`}
              </p>
            )}
          </div>
          {factura.descripcion_operacion && (
            <div className="campo ancho-2">
              <span>Descripción</span>
              <p className="valor">{factura.descripcion_operacion}</p>
            </div>
          )}
        </div>
      </div>

      <div className="tabla-envoltura">
        <table className="tabla">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="a-derecha">Cantidad</th>
              <th className="a-derecha">Precio</th>
              <th className="a-derecha">Dto</th>
              <th className="a-derecha">IVA</th>
              <th className="a-derecha">Base</th>
            </tr>
          </thead>
          <tbody>
            {factura.lineas.map((l) => (
              <tr key={l.orden}>
                <td>{l.concepto}</td>
                <td className="numero">{numero(Number(l.cantidad), 2)}</td>
                <td className="numero">{euros(Number(l.precio_unitario))}</td>
                <td className="numero">{Number(l.descuento_pct)} %</td>
                <td className="numero">{Number(l.tipo_iva)} %</td>
                <td className="numero">{euros(Number(l.base))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bloque totales" style={{ marginTop: 16 }}>
        <div className="desglose">
          {factura.impuestos
            .filter((i) => i.impuesto === "IVA")
            .map((i) => (
              <p key={`iva-${i.tipo_pct}`}>
                <span>
                  IVA {Number(i.tipo_pct)} % sobre {euros(Number(i.base))}
                </span>
                <strong className="dato">{euros(Number(i.cuota))}</strong>
              </p>
            ))}
          {factura.impuestos
            .filter((i) => i.impuesto === "IRPF")
            .map((i) => (
              <p key={`irpf-${i.tipo_pct}`}>
                <span>
                  Retención {Number(i.tipo_pct)} % sobre {euros(Number(i.base))}
                </span>
                <strong className="dato">−{euros(Number(i.cuota))}</strong>
              </p>
            ))}
        </div>
        <div className="resumen">
          <p>
            <span>Base imponible</span>
            <strong className="dato">{euros(Number(factura.base_total))}</strong>
          </p>
          <p>
            <span>Cuota de IVA</span>
            <strong className="dato">{euros(Number(factura.cuota_iva_total))}</strong>
          </p>
          <p className={hayRetencion ? undefined : "gran-total"}>
            <span>Total factura</span>
            <strong className="dato">{euros(totalFactura)}</strong>
          </p>
          {hayRetencion && (
            <>
              <p>
                <span>Retención de IRPF</span>
                <strong className="dato">−{euros(Number(factura.cuota_retencion))}</strong>
              </p>
              <p className="gran-total">
                <span>Total a pagar</span>
                <strong className="dato">{euros(Number(factura.total))}</strong>
              </p>
            </>
          )}
        </div>
      </div>

      {hayRetencion && (
        <p className="pista">
          Los dos importes van separados a propósito: el registro de la AEAT y el QR llevan el
          «Total factura», sin restar la retención, porque el IRPF no forma parte del registro de
          facturación. Lo que se cobra es el «Total a pagar».
        </p>
      )}

      <fieldset className="bloque" style={{ marginTop: 16 }}>
        <legend>Registro Verifactu</legend>
        {!alta && (
          <p className="texto-suave">Esta factura no tiene registro de alta. Avisar antes de tocar nada.</p>
        )}
        {alta && (
          <div className="verifactu">
            <div className="verifactu-datos">
              <p>
                <span>Orden en la cadena</span>
                <strong className="dato">{alta.orden}</strong>
              </p>
              <p>
                <span>Huella</span>
                <strong className="dato huella">{alta.huella}</strong>
              </p>
              <p>
                <span>Huella anterior</span>
                <strong className="dato huella">
                  {alta.huella_anterior ?? "— es el primer registro de la sociedad —"}
                </strong>
              </p>
              <p>
                <span>Momento del registro</span>
                <strong className="dato">
                  {new Date(alta.fecha_hora_registro).toLocaleString("es-ES")}
                </strong>
              </p>
              <p>
                <span>Remisión</span>
                <strong>{ESTADO_ENVIO[factura.envio?.estado ?? ""] ?? "sin cola de envío"}</strong>
              </p>
              {factura.envio?.csv_aeat && (
                <p>
                  <span>CSV de la AEAT</span>
                  <strong className="dato">{factura.envio.csv_aeat}</strong>
                </p>
              )}
            </div>

            {qrSvg && (
              <div className="verifactu-qr">
                <p className="qr-titulo">QR tributario:</p>
                <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                <p className="qr-leyenda">Factura verificable en la sede electrónica de la AEAT</p>
              </div>
            )}
          </div>
        )}
        <p className="pista" style={{ marginTop: 12 }}>
          La remisión a la AEAT todavía no está implementada: el registro queda en cola. El QR apunta
          al <strong>entorno de pruebas</strong> mientras no se valide una factura de prueba contra
          la AEAT.
        </p>
      </fieldset>

      <div className="acciones" style={{ marginTop: 16 }}>
        {/* <a> y no <Link>: es una descarga, no una navegación de la app. */}
        <a className="boton boton-auto" href={ruta(`/facturas/${factura.id}/pdf`)} target="_blank" rel="noreferrer">
          Ver PDF
        </a>
      </div>

      {factura.estado === "expedida" && <BotonAnular id={factura.id} numero={factura.numero_completo ?? ""} />}
    </>
  );
}
