#!/usr/bin/env python3
"""
Convierte un fichero Norma 43 (AEB, texto plano — descarga de Bankinter,
Cajamar, etc.) en el JSON que carga scripts/cargar-extracto-caixa-sepa.mjs.
El saldo por movimiento no viene en la Norma 43: se reconstruye desde el saldo
inicial de la cabecera y se valida contra los totales y el saldo final del
registro 33. El fichero y el JSON NUNCA entran en el repo.

Uso: python3 scripts/generar-extracto-n43.py <fichero.txt> <salida.json>

Registros: 11 cabecera de cuenta · 22 movimiento · 23xx conceptos
complementarios · 33 fin de cuenta · 88 fin de fichero.
"""
import json
import re
import sys
from datetime import datetime

NUESTROS = ("BONITA MEN", "BODEGAS BINIFADET")
RUIDO = re.compile(
    r"^(FACTURA|FACT|FRA|FRAS|DEVOL|COBRO|ABONO|RECIBO|PAGO|PAG|REMESA|CUOTA|LIQ"
    r"|TRANSFERENCIA|IMPUESTO|NOT|TRASP|TRASPASO|COMIS|COMISION|RECOBRO|INT\.|CARGO)[\s.:/-]", re.I)


def limpio(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def fecha_iso(aammdd):
    return datetime.strptime(aammdd, "%y%m%d").date().isoformat()


def contraparte_de(candidatos):
    for c in candidatos:
        c = limpio(c)
        c = re.sub(r"\s*NOTPROVIDE\S*$", "", c).strip()
        if not c or c[0].isdigit() or c.startswith("#"):
            continue
        u = c.upper()
        if any(n in u for n in NUESTROS):
            continue
        if RUIDO.match(c):
            continue
        if len(re.sub(r"[^A-Za-zÑÁÉÍÓÚÜñáéíóúü]", "", c)) < 4:
            continue
        return c
    return None


def main():
    if len(sys.argv) != 3:
        sys.exit("Uso: generar-extracto-n43.py <fichero.txt> <salida.json>")
    lineas = [l.rstrip("\n") for l in open(sys.argv[1], encoding="latin-1") if l.strip()]

    saldo = None
    movs, actual = [], None
    n_debe = n_haber = 0
    t_debe = t_haber = 0.0

    for l in lineas:
        reg = l[:2]
        if reg == "11":
            # 11 + entidad(4) + oficina(4) + cuenta(10) + f.inicial(6) + f.final(6)
            # + clave saldo(1: 1 deudor / 2 acreedor) + saldo inicial(14) + divisa(3)
            clave = l[32]
            saldo = int(l[33:47]) / 100 * (1 if clave == "2" else -1)
            cuenta = l[10:20]
            print(f"Cuenta {l[2:6]}-{l[6:10]}-{cuenta} · {fecha_iso(l[20:26])} → {fecha_iso(l[26:32])} · saldo inicial {saldo:.2f}")
        elif reg == "22":
            # 22 + libre(4) + oficina(4) + f.op(6) + f.valor(6) + común(2) + propio(3)
            # + clave(1: 1 debe / 2 haber) + importe(14) + documento(10) + ref1(12) + ref2(16)
            clave = l[27]
            importe = int(l[28:42]) / 100 * (1 if clave == "2" else -1)
            if clave == "2":
                n_haber += 1; t_haber += abs(importe)
            else:
                n_debe += 1; t_debe += abs(importe)
            saldo = round(saldo + importe, 2)
            actual = {
                "fecha": fecha_iso(l[10:16]),
                "fecha_valor": fecha_iso(l[16:22]),
                "importe": round(importe, 2),
                "saldo": saldo,
                "n43_comun": l[22:24],
                "n43_propio": l[24:27],
                "documento": limpio(l[42:52]).lstrip("0"),
                "referencia": limpio(l[52:64]).lstrip("0") or limpio(l[64:80]),
                "comps": [],
            }
            movs.append(actual)
        elif reg == "23" and actual is not None:
            actual["comps"].append(limpio(l[4:]))
        elif reg == "33":
            # 33 + entidad(4) + oficina(4) + cuenta(10) + n debe(5) + total debe(14)
            # + n haber(5) + total haber(14) + clave saldo(1) + saldo final(14) + divisa(3)
            fd, td = int(l[20:25]), int(l[25:39]) / 100
            fh, th = int(l[39:44]), int(l[44:58]) / 100
            sf = int(l[59:73]) / 100 * (1 if l[58] == "2" else -1)
            if (fd, fh) != (n_debe, n_haber) or abs(td - t_debe) > 0.005 or abs(th - t_haber) > 0.005:
                sys.exit(f"NO CUADRA registro 33: debe {n_debe}/{t_debe:.2f} vs {fd}/{td:.2f}, haber {n_haber}/{t_haber:.2f} vs {fh}/{th:.2f}")
            if abs(sf - saldo) > 0.005:
                sys.exit(f"NO CUADRA saldo final: calculado {saldo:.2f} vs fichero {sf:.2f}")
            print(f"Registro 33 OK: {n_debe} cargos {t_debe:.2f} · {n_haber} abonos {t_haber:.2f} · saldo final {sf:.2f}")

    salida = []
    for m in movs:
        comps = m.pop("comps")
        contraparte = contraparte_de(comps)
        partes, vistos = [], set()
        for p in [contraparte] + comps + [m["referencia"], m["documento"]]:
            p = limpio(p or "")
            if not p or p.upper() in vistos or any(n in p.upper() for n in NUESTROS):
                continue
            vistos.add(p.upper())
            partes.append(p)
        m.pop("documento")
        m["contraparte"] = contraparte
        m["extra"] = " · ".join(partes)[:350] or None
        m["concepto"] = (contraparte or (comps[0] if comps else "") or "MOV BANCO")[:60]
        m["referencia"] = m["referencia"] or None
        salida.append(m)

    claves = {(m["fecha"], m["importe"], m["saldo"]) for m in salida}
    if len(claves) != len(salida):
        sys.exit(f"clave fecha+importe+saldo NO única: {len(salida)} movs, {len(claves)} claves")

    with open(sys.argv[2], "w") as f:
        json.dump(salida, f, ensure_ascii=False)
    print(f"{len(salida)} movimientos → {sys.argv[2]}")


if __name__ == "__main__":
    main()
