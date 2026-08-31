#!/usr/bin/env python3
"""
Convierte el XLS de CaixaBank «Con referencias SEPA y conceptos adicionales»
(descarga en diferido, p.ej. TT280826.440.XLS) en el JSON que carga
scripts/cargar-extracto-caixa-sepa.mjs. El XLS y el JSON NUNCA entran en el
repo: llevan nombres y datos reales.

Uso: python3 scripts/generar-extracto-caixa-sepa.py <ruta.XLS> <salida.json>

Columnas del XLS (cabecera en la fila 4): cuenta, oficina, divisa,
F. Operación, F. Valor, Ingreso(+), Gasto(-), Saldo(+), Saldo(-),
Concepto común, Concepto propio, Referencia 1, Referencia 2 y
Conceptos complementarios 1-10 (solo los impares vienen rellenos).
"""
import json
import re
import sys
from datetime import datetime

import xlrd

NUESTROS = ("BONITA MEN",)  # cubre «BONITA MENORCA S.L» y el truncado «BONITA MEN»
# arranques que delatan un concepto, no un nombre (FACT. 1234, DEVOL. …, PAG NOMINAS…)
RUIDO = re.compile(
    r"^(FACTURA|FACT|FRA|FRAS|DEVOL|COBRO|ABONO|RECIBO|PAGO|PAG|REMESA|CUOTA|LIQ"
    r"|TRANSFERENCIA|IMPUESTO|NOT)[\s.:/-]", re.I)


def limpio(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def es_nuestro(s):
    u = s.upper()
    return any(n in u for n in NUESTROS)


def contraparte_de(candidatos):
    """Primer candidato que parece un nombre y no somos nosotros."""
    for c in candidatos:
        c = limpio(c)
        if c.startswith("CORE") and len(c) > 4:
            c = c[4:]  # marcador del esquema SEPA CORE, no es parte del nombre
        c = re.sub(r"\s*NOTPROVIDE\S*$", "", c).strip()
        if not c or es_nuestro(c) or c[0].isdigit():
            continue
        if RUIDO.match(c) or c.upper() == "NOT PROVIDED":
            continue
        if len(re.sub(r"[^A-Za-zÑÁÉÍÓÚÜñáéíóúü]", "", c)) < 4:
            continue
        return c
    return None


def main():
    if len(sys.argv) != 3:
        sys.exit("Uso: generar-extracto-caixa-sepa.py <ruta.XLS> <salida.json>")
    wb = xlrd.open_workbook(sys.argv[1])
    hoja = wb.sheet_by_index(0)

    movs = []
    for i in range(4, hoja.nrows):
        v = [hoja.cell_value(i, c) for c in range(hoja.ncols)]
        if not str(v[1]).strip():
            continue
        fecha = datetime.strptime(str(v[4]).strip(), "%d/%m/%Y").date().isoformat()
        fvalor = datetime.strptime(str(v[5]).strip(), "%d/%m/%Y").date().isoformat()
        importe = round(float(v[6]) if str(v[6]).strip() else -float(v[7]), 2)
        saldo = round(float(v[8]) if str(v[8]).strip() else -float(v[9]), 2)
        comun, propio = limpio(v[10]), limpio(v[11])
        ref2 = limpio(v[13])
        c1, c3, c5, c7, c9 = (limpio(v[c]) for c in (14, 16, 18, 20, 22))

        contraparte = contraparte_de([c1, c5, c7, c9, c3])

        partes, vistos = [], set()
        for p in [contraparte, c3, c5, c7, c9, ref2]:
            p = limpio(p or "")
            if not p or es_nuestro(p) or p.upper() in vistos:
                continue
            vistos.add(p.upper())
            partes.append(p)
        extra = " · ".join(partes)[:350]

        movs.append({
            "fecha": fecha,
            "fecha_valor": fvalor,
            "importe": importe,
            "saldo": saldo,
            "concepto": (contraparte or c3 or c5 or "MOV BANCO")[:60],
            "n43_comun": comun or None,
            "n43_propio": propio or None,
            "referencia": ref2 or None,
            "contraparte": contraparte,
            "extra": extra or None,
        })

    claves = {(m["fecha"], m["importe"], m["saldo"]) for m in movs}
    if len(claves) != len(movs):
        sys.exit(f"clave fecha+importe+saldo NO única: {len(movs)} movs, {len(claves)} claves")

    with open(sys.argv[2], "w") as f:
        json.dump(movs, f, ensure_ascii=False)
    print(f"{len(movs)} movimientos → {sys.argv[2]}")


if __name__ == "__main__":
    main()
