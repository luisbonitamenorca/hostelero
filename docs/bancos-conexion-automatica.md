# Conexión automática con los bancos — arquitectura (propuesta 15-09-2026)

## Objetivo
Que Contabilidad reciba cada día los movimientos de todas las cuentas bancarias sin cargar
extractos a mano, y que entren por la misma tubería de conciliación que ya funciona.

## Lo que ya existe (no se toca)
```
fichero N43 / SEPA  →  fin_n43_staging  →  fin_n43_absorber(banco)  →  fin_banco_movimientos
                                                                          ↓
                                                        fin_cruce_aplicar(banco) (reglas + sugerencias)
                                                                          ↓
                                                        conciliación con cartera / diario
```
- `fin_n43_staging`: fecha, fecha_valor, importe, saldo, concepto, n43_comun, n43_propio, referencia, contraparte, extra.
- `fin_n43_absorber` (v3): dedupe por fecha + importe + saldo (y rango de saldo intradía); hash_mov por banco.
- 5 cuentas en `fin_bancos_cuentas`: CaixaBank principal, Bankinter 1816, Bankinter 4722 (póliza), Cajamar 9892, Cajamar 0484 (póliza). 3.144 movimientos hasta 31-08-2026.
- Infra disponible en el proyecto: `pg_net` instalado, `pg_cron` disponible, Vault para secretos, sin Edge Functions aún.

## Cómo conectar: opciones evaluadas
| Opción | Qué es | A favor | En contra |
|---|---|---|---|
| **A. Agregador PSD2** (Enable Banking, Tink, Salt Edge, Yapily) | API única que habla con la API PSD2 de cada banco (en España casi todas vía Redsys) | Un solo contrato; cubre CaixaBank, Bankinter, Cajamar; alta rápida; datos JSON limpios | Consentimiento renovable por una persona cada 90/180 días con SCA en el móvil; **las pólizas de crédito suelen no estar expuestas por PSD2**; no da el saldo por movimiento; precio por conexión bajo cotización |
| **B. EBICS / host-to-host con cada banco** | Canal corporativo por el que el banco envía el fichero N43 cada noche | Fichero N43 auténtico (saldo por movimiento, códigos comunes/propios); sin renovaciones de consentimiento; cubre pólizas | Contrato y cuota por banco; certificados; cliente EBICS que hay que hospedar; setup lento con cada gestor |
| **C. A3Bank** | Lo que la asesoría está implantando para A3 | Ya en marcha, lo pagan ellos | Alimenta A3, no Hostelero; no hay forma de leer lo que descarga; no sirve como fuente |
| **D. Robot sobre la banca online** (CaixaBankNow) | Descarga programada simulando al usuario | Sin contratos | Frágil, contra las condiciones del banco, SCA; descartado |

**GoCardless Bank Account Data (ex Nordigen) está cerrado a nuevas altas** (la opción gratuita de otros años ya no existe).

## Decisión propuesta
**Fase 1: agregador PSD2 (Enable Banking como primera opción) para las 3 cuentas corrientes.**
Es lo que se puede tener funcionando en días con un solo contrato. **Fase 2: EBICS con CaixaBank**
solo si la renovación de consentimiento cada pocos meses resulta un dolor o si hace falta cubrir
las pólizas por canal automático. Las pólizas siguen entrando por N43 manual (poco movimiento).

Si Enable Banking no cotiza bien, mismas piezas con Tink o Salt Edge: el diseño de abajo no
depende del proveedor.

## Diseño (independiente del proveedor)
```
[Banco] ──PSD2/EBICS──▶ conector ──▶ fin_n43_staging ──▶ fin_n43_absorber ──▶ fin_banco_movimientos ──▶ fin_cruce_aplicar
                          ▲                                                      
       fin_banco_conexiones (proveedor, id externo, consentimiento, caducidad, último sync)
       fin_banco_descargas  (log por ejecución: nuevos, duplicados, errores)
```
### Tablas nuevas (fin_*)
- `fin_banco_conexiones`: banco_cuenta_id → proveedor (`psd2_enable`, `ebics`, `manual`), id de cuenta en el proveedor, estado del consentimiento, `consentimiento_hasta`, `ultimo_sync`, `ultimo_error`, `activa`. Los tokens y secretos **no** van aquí: van a Vault / secretos de la función.
- `fin_banco_descargas`: conexión, `desde`, `hasta`, `recibidos`, `nuevos`, `duplicados`, `error`, `ejecutado_en`.
- `fin_n43_absorber` v4: además del match por fecha+importe+saldo, dedupe por **referencia externa** (`transactionId` del banco) cuando llega sin saldo (PSD2 no da saldo por movimiento). Cambio pequeño en una función existente.

### Conector (Supabase Edge Function `bancos-sync`)
1. Cada noche (`pg_cron` → `pg_net` → la función; o Vercel Cron) recorre las conexiones activas.
2. Pide al proveedor los movimientos desde `ultimo_sync − 5 días` (los bancos reordenan el intradía y anotan tarde).
3. Normaliza al formato de `fin_n43_staging`: fecha = bookingDate, fecha_valor = valueDate, importe con signo, concepto = remittanceInformation, contraparte = creditor/debtor name, referencia = transactionId, extra = JSON crudo.
4. Llama a `fin_n43_absorber(banco)` y a `fin_cruce_aplicar(banco)`. Registra en `fin_banco_descargas`.
5. Si el consentimiento caduca en menos de 15 días, marca aviso.

### Pantalla Contabilidad › Bancos
- Por cuenta: estado de la conexión, último sync, movimientos nuevos hoy, botón **Sincronizar ahora**.
- **Conectar banco**: abre el flujo del proveedor (redirección al banco, SCA en el móvil de Luis), vuelve con la cuenta enlazada.
- **Renovar consentimiento** con aviso de caducidad. La subida manual de N43 sigue disponible como respaldo.

## Lo que hace falta de Luis antes de codear
1. Alta en el proveedor y cotización (Enable Banking: formulario "Get a quote"; alternativa Tink o Salt Edge). Datos de la empresa y del responsable.
2. Confirmar cuentas de la fase 1: CaixaBank principal, Bankinter 1816, Cajamar 9892. Pólizas fuera de momento.
3. Quién autoriza el consentimiento en cada banco (debe tener acceso a la banca online de empresa de ese banco con SCA) y asumir la renovación periódica.
4. Preguntar al gestor de CaixaBank coste y requisitos del canal EBICS con envío diario de N43, por si vamos a fase 2.

## Plan de sesiones
1. Tablas + absorber v4 + función `bancos-sync` con proveedor `manual` (misma tubería, sin banco): deja el esqueleto probado con los N43 actuales.
2. Conector Enable Banking: alta de conexión (redirección + callback), descarga, cron nocturno, pantalla en Bancos.
3. Avisos de caducidad, reintentos, log visible, y si procede EBICS CaixaBank.
