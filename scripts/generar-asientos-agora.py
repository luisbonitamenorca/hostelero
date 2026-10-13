#!/usr/bin/env python3 -I
"""Ingresos de Ágora → Contabilidad (13-10-2026). Genera el JSON de asientos que carga
scripts/cargar-asientos.mjs a partir del listado «Facturas» de Ágora (el .xls que exporta
Ágora es en realidad una tabla HTML).

    python3 -I scripts/generar-asientos-agora.py "Facturas.xls" --desde=2026-10-13 --hasta=2026-10-31 \
        [--nominativas-desde=2026-10-13] [--saltar=numeros.txt] [--cuentas=cuentas43.json] [--salida=asientos.json]

Después:
    node scripts/cargar-asientos.mjs asientos.json        (borradores)
    confirmar en orden de fecha con fin_confirmar_asiento (como Luis) y crear los vencimientos
    de cobro de las nominativas por transferencia/giro con asientos_vencimientos.json.

Reglas (las de la carga «desde cero», docs/tecnico/contabilidad.md §4.1):
  · Día y local (Fra. Simp. + Dev. Simp.): «Ventas DD-MM Centro (N tickets)»
      debe 570000000 = total + propinas · haber 700000000 (centro) por tipo de IVA,
      477000004/010/021 por tipo, 570000500 propinas.
  · Nominativa (Factura / Devolución): «Fra. NUM (Cliente)»: 43x del cliente por total+propina ·
      700 (centro) · 477 · 570000500. Si NO es transferencia/giro, asiento «Cobro Fra. NUM · FORMA»
      (570000000 ← 43x) el mismo día; si lo es, vencimiento de cobro a 30 días (fichero aparte).
  · La cuenta 43x: «Cuenta Contable» del listado; si no, por NIF o nombre en --cuentas (json
      {"NIF o NOMBRENORMALIZADO": "codigo"}); si no se encuentra, la factura se salta y se avisa:
      hay que crear la cuenta 4307xxxxx en el plan y añadirla al json.
  · --saltar: números de factura ya contabilizados (consultar fin_asientos antes).
  · El último día del listado suele estar a medias: --hasta debe ser un día COMPLETO.
Sin datos personales en la salida de consola.
"""
import sys, re, json, html, collections

args = sys.argv[1:]
FICHERO = next((a for a in args if not a.startswith("--")), None)
def opt(n, d=None):
    v = next((a for a in args if a.startswith(f"--{n}=")), None)
    return v.split("=", 1)[1] if v else d
if not FICHERO or not opt("desde") or not opt("hasta"):
    sys.exit(__doc__)
DESDE, HASTA = opt("desde"), opt("hasta")
DESDE_NOM = opt("nominativas-desde", DESDE)
SALIDA = opt("salida", "asientos.json")
saltar = set(l.strip() for l in open(opt("saltar"))) if opt("saltar") else set()
cuentas43 = json.load(open(opt("cuentas"))) if opt("cuentas") else {}

CENTRO_A3 = {"BINIFADET": 4, "TIENDA": 5, "TAMARINDOS": 6, "TAMARINDOS BAR": 7, "TIRANT": 8, "BODEGA": 2}
CENTRO_NOMBRE = {"BINIFADET": "Binifadet Restaurante", "TIENDA": "Binifadet Tienda", "TAMARINDOS": "Tamarindos Restaurante",
                 "TAMARINDOS BAR": "Tamarindos Bar", "TIRANT": "Casa Tirant", "BODEGA": "Binifadet Bodega"}
CTA_IVA = {4: "477000004", 10: "477000010", 21: "477000021"}
# Códigos que Ágora trae y no existen en el plan → su cuenta real
CTA_ALIAS = {"430100012": "430000248", "430700290": "430000185", "430000023": "430700493"}

# ── leer el HTML disfrazado de .xls ──
texto = open(FICHERO, encoding="utf-8", errors="replace").read()
filas = re.findall(r"<tr[^>]*>(.*?)</tr>", texto, re.S)
def celdas(r): return [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)]
cab = celdas(filas[0]); ix = {h: i for i, h in enumerate(cab)}
data = [c for c in (celdas(r) for r in filas[1:]) if len(c) == len(cab) and c[0]]
for col in ("Fecha", "Número", "Local", "Tipo Doc.", "Forma de Pago", "Cliente", "CIF/NIF", "Cuenta Contable", "Base", "Cuota", "Total", "Propina"):
    if col not in ix: sys.exit(f"falta la columna {col} en el listado")

def num(x): return float(x.replace(".", "").replace(",", ".")) if x else 0.0
def iso(f): return f[6:] + "-" + f[3:5] + "-" + f[:2]
def r2(x): return round(x + 1e-9, 2)
def ddmm(f): return f[8:10] + "-" + f[5:7]
def tramo(base, cuota):
    if base == 0: return 0 if cuota == 0 else 21
    p = cuota / base * 100
    return 0 if p < 2 else 4 if p < 7 else 10 if p < 15.5 else 21
def norm(s): return re.sub(r"[^A-Z0-9]", "", s.upper().replace("Á","A").replace("É","E").replace("Í","I").replace("Ó","O").replace("Ú","U").replace("Ñ","N"))

def lineas_iva(buckets, centro):
    out = []
    for t in sorted(buckets):
        b, c = r2(buckets[t][0]), r2(buckets[t][1])
        if b: out.append(("700000000", b, centro))
        if c and t: out.append((CTA_IVA[t], c, None))
    return out

def asiento(fecha, concepto, debe_lineas, haber_lineas):
    lineas = []
    for cta, imp, centro in debe_lineas:
        lineas.append([cta, r2(imp) if imp >= 0 else 0, 0 if imp >= 0 else r2(-imp), centro])
    for cta, imp, centro in haber_lineas:
        lineas.append([cta, 0 if imp >= 0 else r2(-imp), r2(imp) if imp >= 0 else 0, centro])
    lineas = [l for l in lineas if l[1] or l[2]]
    dif = r2(r2(sum(l[1] for l in lineas)) - r2(sum(l[2] for l in lineas)))
    if dif:
        for l in lineas:
            if l[0] == "700000000":
                if l[2]: l[2] = r2(l[2] + dif)
                else: l[1] = r2(l[1] - dif)
                break
        else:
            sys.exit(f"descuadre sin línea 700 en {concepto}: {dif}")
    return {"fecha": fecha, "concepto": concepto, "lineas": lineas}

def cuenta_cliente(d):
    cta = d[ix["Cuenta Contable"]].strip()
    cta = CTA_ALIAS.get(cta, cta)
    if cta: return cta
    nif = re.sub(r"[^A-Za-z0-9]", "", d[ix["CIF/NIF"]]).upper()
    if nif and nif in cuentas43: return cuentas43[nif]
    n = norm(d[ix["Cliente"]])
    if n in cuentas43: return cuentas43[n]
    for k, v in cuentas43.items():
        if len(k) > 8 and (k in n or n in k): return v
    return None

asientos, vencimientos, nominativas = [], [], []
avisos = collections.Counter()
dias = collections.defaultdict(lambda: {"n": 0, "total": 0.0, "prop": 0.0, "b": collections.defaultdict(lambda: [0.0, 0.0])})

for d in data:
    f = iso(d[ix["Fecha"]]); local = d[ix["Local"]]; tipo = d[ix["Tipo Doc."]]
    base, cuota, total, prop = (num(d[ix[c]]) for c in ("Base", "Cuota", "Total", "Propina"))
    if local not in CENTRO_A3: avisos["local desconocido " + local] += 1; continue
    if tipo in ("Factura", "Devolución"):
        if DESDE_NOM <= f <= HASTA and d[ix["Número"]] not in saltar:
            nominativas.append((f, local, d[ix["Número"]], d, base, cuota, total, prop))
        elif DESDE_NOM <= f <= HASTA: avisos["nominativa ya contabilizada (saltada)"] += 1
        continue
    if not (DESDE <= f <= HASTA): continue
    a = dias[(f, local)]; a["n"] += 1; a["total"] += total; a["prop"] += prop
    t = tramo(base, cuota); a["b"][t][0] += base; a["b"][t][1] += cuota

for (f, local), a in sorted(dias.items()):
    if abs(a["total"]) < 0.005 and abs(a["prop"]) < 0.005: continue
    haber = lineas_iva(a["b"], CENTRO_A3[local])
    if r2(a["prop"]): haber.append(("570000500", r2(a["prop"]), None))
    asientos.append(asiento(f, f"Ventas {ddmm(f)} {CENTRO_NOMBRE[local]} ({a['n']} tickets)", [("570000000", r2(a["total"] + a["prop"]), None)], haber))

for f, local, numero, d, base, cuota, total, prop in sorted(nominativas, key=lambda x: (x[0], x[2])):
    cta = cuenta_cliente(d)
    if not cta: avisos["sin cuenta 43x (crear en el plan y añadir a --cuentas): " + numero] += 1; continue
    cliente = d[ix["Cliente"]].strip(); forma = d[ix["Forma de Pago"]].strip()
    haber = lineas_iva({tramo(base, cuota): [base, cuota]}, CENTRO_A3[local])
    if r2(prop): haber.append(("570000500", r2(prop), None))
    asientos.append(asiento(f, f"Fra. {numero} ({cliente})", [(cta, r2(total + prop), None)], haber))
    es_cartera = bool(re.search(r"transferencia|giro", forma, re.I))
    if total > 0 and es_cartera:
        vencimientos.append({"numero": numero, "fecha": f, "importe": r2(total + prop), "forma": "giro" if re.search("giro", forma, re.I) else "transferencia", "cuenta": cta})
    elif total != 0 and not es_cartera:
        asientos.append(asiento(f, f"Cobro Fra. {numero} · {forma or 'sin forma'}", [("570000000", r2(total + prop), None)], [(cta, r2(total + prop), None)]))

orden = {"Ventas": 0, "Fra.": 1, "Cobro": 2}
asientos.sort(key=lambda a: (a["fecha"], orden.get(a["concepto"].split(" ")[0], 9), a["concepto"]))
json.dump(asientos, open(SALIDA, "w"), ensure_ascii=False)
json.dump(vencimientos, open(SALIDA.replace(".json", "_vencimientos.json"), "w"), ensure_ascii=False)

n = collections.Counter(a["concepto"].split(" ")[0] for a in asientos)
print(f"asientos: {len(asientos)} → {dict(n)} · vencimientos de cobro: {len(vencimientos)} · fichero {SALIDA}")
print("debe:", r2(sum(l[1] for a in asientos for l in a["lineas"])), "haber:", r2(sum(l[2] for a in asientos for l in a["lineas"])),
      "· ingreso 700 neto:", r2(sum(l[2] - l[1] for a in asientos for l in a["lineas"] if l[0] == "700000000")))
for k, v in avisos.items(): print("aviso:", k, v)
