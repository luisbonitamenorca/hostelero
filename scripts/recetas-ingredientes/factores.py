"""Factores de formato de los vínculos producto → ingrediente de Recetas.

El precio de Compras suele ser por envase (garrafa de 5 l, bolsa de 2,4 kg, caja de 30 huevos) y el
factor del vínculo (unidades de ingrediente por unidad de compra) se dejó a 1 al cargar. Este script
deduce el factor del NOMBRE del producto cuando la medida que aparece casa con la unidad del ingrediente.

Modos:
  python3 scripts/recetas-ingredientes/factores.py proponer          → Excel de revisión en ~/Downloads
  python3 scripts/recetas-ingredientes/factores.py aplicar <xlsx>    → aplica la columna «Factor OK / corrección»
                                                                        (vacío = acepta el propuesto; número = ese; 1 = dejar a 1)

Reglas (en el nombre, sin distinguir mayúsculas; «,» y «'» valen como coma decimal):
  litros:  «5L», «1,5 L», «750ML», «70CL», «0,7L», «6UNX1L» (6 × 1 l), «3X5L», «12BOTX250ML»
  kilos:   «5KG», «2,4 kg», «500GR», «1KGM», «4 x 2'5» (4 × 2,5 kg), «10UNX1KG», «(2.3KGne)» (neto manda)
  unidades: «20u», «24U», «C/4UD», «CAJA 6UD», «EST.10U», «30DC» (docenas → ×12), «C/30D», «24B», «12 PZ»
Si la unidad del ingrediente no casa con lo que dice el nombre, factor 1 y regla «sin dato».
Aviso «revisar» cuando el €/ud resultante se sale del rango plausible o se aleja mucho de la mediana del
ingrediente. Claves en apps/general/.env.local (service role).
"""
import json, os, re, statistics, sys, urllib.request
from collections import defaultdict

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
CUENTA = '082c5366-d9ae-49b9-a8b8-8caad73985bd'
env = {}
for l in open(os.path.join(RAIZ, 'apps/general/.env.local')):
    l = l.strip()
    if '=' in l and not l.startswith('#'):
        k, v = l.split('=', 1); env[k] = v.strip().strip('"').strip("'")
URL, KEY = env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']
H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}

def api(method, path, body=None, prefer=None, rango=None):
    h = dict(H)
    if prefer: h['Prefer'] = prefer
    if rango: h['Range-Unit'] = 'items'; h['Range'] = rango
    req = urllib.request.Request(URL + '/rest/v1/' + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read().decode(); return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path} → {e.code}: {e.read().decode()[:400]}')

def fetch_all(path):
    out, desde = [], 0
    while True:
        chunk = api('GET', path, rango=f'{desde}-{desde+999}') or []
        out += chunk
        if len(chunk) < 1000: return out
        desde += 1000

NUM = r"(\d+(?:[.,']\d+)?)"
def num(s): return float(s.replace("'", '.').replace(',', '.'))

def candidatos(nombre, unidad):
    """Factores posibles según el nombre: lista de (factor, regla). Vacía si no hay medida que case."""
    n = ' ' + re.sub(r'\s+', ' ', nombre.upper()).replace('Ø', '0') + ' '
    out = []
    # pack: «6UNX1L», «3X5L», «4 x 2'5», «12BOTX250ML», «10UNX1KG» → el precio puede ser por pack o por unidad del pack
    mult = re.search(r"(?<![\d,.'])(\d{1,3})\s*(?:UN|UNI|UNID|UNIDADES|UD|UDS|BOT|BOTELLAS|BOLS|CAJAS?|PAQ|TARROS?|U|B)?\s*[Xx×]\s*" + NUM + r"\s*(L|LT|LTS|LITROS?|ML|CL|CC|KG|KGS|KGM|KILOS?|GR|GRS|G|GRAMOS)?\b", n)
    if mult:
        cant, tam, u = int(mult.group(1)), num(mult.group(2)), (mult.group(3) or '')
        base = None
        if unidad == 'l':
            if u in ('L', 'LT', 'LTS', 'LITRO', 'LITROS'): base = (tam, 'l')
            elif u in ('ML', 'CC'): base = (tam / 1000, 'ml')
            elif u == 'CL': base = (tam / 100, 'cl')
        elif unidad == 'kg':
            if u in ('KG', 'KGS', 'KGM', 'KILO', 'KILOS'): base = (tam, 'kg')
            elif u in ('GR', 'GRS', 'G', 'GRAMOS'): base = (tam / 1000, 'g')
            elif u == '' and tam < 30 and re.search(r"\d\s*[Xx]\s*\d+'\d", n): base = (tam, "kg (formato «x 2'5»)")
        elif unidad == 'ud' and u == '' and cant > 1:
            out.append((cant, f'pack de {cant}'))
        if base:
            out.append((cant * base[0], f'pack {cant} × {tam:g} {base[1]} (precio por pack)'))
            out.append((base[0], f'{tam:g} {base[1]} (precio por unidad del pack de {cant})'))
    if unidad == 'l':
        m = re.search(r"(?<![\d,.'])" + NUM + r"\s*(?:L|LT|LTS|LITROS?|LIT\.?)\b", n)
        if m: out.append((num(m.group(1)), f'{num(m.group(1)):g} l'))
        m = re.search(r"(?<![\d,.'])" + NUM + r"\s*(?:ML|CC)\b", n)
        if m: out.append((num(m.group(1)) / 1000, f'{num(m.group(1)):g} ml'))
        m = re.search(r"(?<![\d,.'])" + NUM + r"\s*CL\b", n)
        if m: out.append((num(m.group(1)) / 100, f'{num(m.group(1)):g} cl'))
        m = re.search(r"\b(\d)/(\d)\b", n)
        if m and int(m.group(2)) > int(m.group(1)): out.append((int(m.group(1)) / int(m.group(2)), f'{m.group(1)}/{m.group(2)} l'))
    elif unidad == 'kg':
        m = re.search(r"\(\s*" + NUM + r"\s*(KG|GR|G)\s*NE\s*\)", n)
        if m:
            v = num(m.group(1)); out.append(((v if m.group(2) == 'KG' else v / 1000), f'{v:g} {"kg" if m.group(2) == "KG" else "g"} neto'))
        m = re.search(r"(?<![\d,.'/])" + NUM + r"\s*(?:KG|KGS|KGM|KILOS?|K)\b", n)
        if m: out.append((num(m.group(1)), f'{num(m.group(1)):g} kg'))
        m = re.search(r"(?<![\d,.'/])" + NUM + r"\s*(?:GR|GRS|GRAMOS|G)\b", n)
        if m: out.append((num(m.group(1)) / 1000, f'{num(m.group(1)):g} g'))
    elif unidad == 'ud':
        m = re.search(r"(?<![\d,.'])(\d{1,3})\s*(?:DC|D\)|DOC|DOCENAS?)\b", n)
        if m: out.append((12, f'docena (precio por docena; en el nombre: {m.group(1)} docenas)')); out.append((12 * int(m.group(1)), f'{m.group(1)} docenas (precio por caja)'))
        m = re.search(r"\bC\s*/\s*(\d{1,3})\s*(?:U|UD|UDS|UN|UNID)?\b", n)
        if m: out.append((int(m.group(1)), f'caja de {m.group(1)}'))
        m = re.search(r"(?<![\d,.'/])(\d{1,3})\s*(?:U|UD|UDS|UN|UNI|UNID|UNIDADES|PZ|PIEZAS|PCS|B|BOT|BOTELLAS|LATAS)\b", n)
        if m and int(m.group(1)) > 1: out.append((int(m.group(1)), f'{m.group(1)} unidades'))
        m = re.search(r"\b(?:CAJA|EST\.?|ESTUCHE|PACK|BOLSA|CUBO)\s*(?:DE\s*)?(\d{1,3})\s*(?:U|UD|UDS|UN|UNI|UNID|UNIDADES)?\b", n)
        if m and int(m.group(1)) > 1: out.append((int(m.group(1)), f'envase de {m.group(1)}'))
    # sin duplicados, conservando el orden
    vistos, res = set(), []
    for f, r in out:
        f = round(f, 4)
        if f > 0 and f not in vistos: vistos.add(f); res.append((f, r))
    return res

RANGO = {'kg': (0.4, 400), 'l': (0.3, 300), 'ud': (0.03, 400)}

def elegir(cands, precio, unidad, ref):
    """Elige el factor. Con referencia del ingrediente (precio por unidad de otros productos del mismo
    ingrediente): el candidato cuyo precio resultante es verosímil y más cercano a ella. Sin referencia:
    el primer candidato del nombre cuyo precio resultante es verosímil; si ninguno lo es y el precio tal
    cual sí, se deja a 1 («precio ya por kg/l»). Devuelve (factor, regla, aviso)."""
    import math
    if not cands: return 1, 'sin dato', ''
    if precio is None or precio <= 0: return cands[0][0], cands[0][1] + ' (sin precio para comprobar)', 'sin precio: comprobar'
    lo, hi = RANGO[unidad]
    ok = lambda f: lo <= precio / f <= hi
    txt = lambda f, r: f'{f:g} ({r}: {precio / f:.2f} €/{unidad})'
    if ref:
        opciones = cands + [(1, f'precio ya por {unidad} (el nombre dice {cands[0][1]})')]
        def puntua(f):
            r = precio / f
            pen = 0 if lo <= r <= hi else 10 + abs(math.log10(r / lo) if r < lo else math.log10(r / hi))
            return pen + abs(math.log10(r / ref))
        ordenadas = sorted(opciones, key=lambda c: puntua(c[0]))
        mejor, segundo = ordenadas[0], ordenadas[1]
        pm, ps = puntua(mejor[0]), puntua(segundo[0])
        if pm >= 10: aviso = f'ningún factor da un precio verosímil ({precio / mejor[0]:.2f} €/{unidad})'
        elif ps - pm < 0.3: aviso = 'también podría ser ' + txt(segundo[0], segundo[1])
        else: aviso = ''
        return mejor[0], mejor[1], aviso
    plausibles = [c for c in cands if ok(c[0])]
    if plausibles:
        # entre pack y unidad del pack, si el pack deja el kilo/litro por debajo de 1 € casi seguro que el
        # precio de Compras es por unidad del pack (bolsa, botella): va primero el que no baje de 1 €
        plausibles.sort(key=lambda c: 0 if precio / c[0] >= 1 or unidad == 'ud' else 1)
        mejor = plausibles[0]
        otros = [c for c in plausibles[1:] if c[0] != mejor[0]]
        return mejor[0], mejor[1], ('también podría ser ' + txt(otros[0][0], otros[0][1])) if otros else ''
    if ok(1): return 1, f'precio ya por {unidad} (el nombre dice {cands[0][1]})', ''
    return cands[0][0], cands[0][1], f'ningún factor da un precio verosímil ({precio / cands[0][0]:.2f} €/{unidad})'

def proponer():
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.table import Table, TableStyleInfo
    vinc = fetch_all(f'rec_ingrediente_producto?cuenta_id=eq.{CUENTA}&select=id,ingrediente_id,producto_id,factor,principal')
    ings = {i['id']: i for i in fetch_all(f'rec_ingrediente?cuenta_id=eq.{CUENTA}&select=id,nombre,unidad')}
    prods = {p['id']: p for p in fetch_all(f'compras_producto?cuenta_id=eq.{CUENTA}&select=id,codigo_interno,nombre,proveedor_nombre,ultimo_precio')}
    # 1ª pasada: candidatos por nombre; referencia del ingrediente = mediana del precio de los productos
    # SIN medida en el nombre (normalmente fresco a granel, precio ya por kg/l/ud) con precio dentro del rango
    pre = []
    for v in vinc:
        i, p = ings.get(v['ingrediente_id']), prods.get(v['producto_id'])
        if not i or not p: continue
        pre.append((v, i, p, candidatos(p['nombre'] or '', i['unidad'])))
    # Referencia: SOLO productos cuyo nombre no lleva ningún número (fresco a granel: «TOMATE PERA»,
    # «ALAS DE POLLO FRESCAS»), que es donde el precio de Compras es de verdad por kg/l. Para «ud» no se
    # usa referencia (las cajas de helados/bebidas sin recuento en el nombre engañan).
    ref_l = defaultdict(list)
    for v, i, p, c in pre:
        lo, hi = RANGO[i['unidad']]
        if i['unidad'] != 'ud' and not re.search(r'\d', p['nombre'] or '') and p['ultimo_precio'] and lo <= p['ultimo_precio'] <= hi: ref_l[i['id']].append(p['ultimo_precio'])
    ref = {k: statistics.median(x) for k, x in ref_l.items()}
    filas = []
    for v, i, p, c in pre:
        precio = p['ultimo_precio']
        factor, regla, aviso = elegir(c, precio, i['unidad'], ref.get(i['id']))
        res = (precio / factor) if precio is not None and factor else None
        filas.append({'vid': v['id'], 'id': p['codigo_interno'], 'producto': p['nombre'], 'proveedor': p['proveedor_nombre'], 'ing': i['nombre'], 'ud': i['unidad'],
                      'precio': precio, 'factor': round(factor, 4), 'regla': regla, 'res': res, 'principal': v['principal'], 'aviso': aviso, 'mediana': ref.get(i['id'])})
    # 2ª pasada: con todos los factores puestos, avisar si un producto se aleja mucho del resto de su ingrediente
    por_ing = defaultdict(list)
    for r in filas:
        if r['res'] is not None: por_ing[r['ing']].append(r['res'])
    for r in filas:
        xs = por_ing[r['ing']]
        if r['res'] is not None and len(xs) >= 3:
            m = statistics.median(xs)
            if r['res'] > m * 4 or r['res'] < m / 4: r['aviso'] = (r['aviso'] + '; ' if r['aviso'] else '') + f'se aleja del resto del ingrediente (mediana {m:.2f} €/{r["ud"]})'
            r['mediana'] = m
    # orden: con aviso y factor ≠ 1 primero, luego factor ≠ 1, luego el resto
    filas.sort(key=lambda r: (0 if (r['factor'] != 1 and r['aviso']) else 1 if r['factor'] != 1 else 2 if r['regla'].startswith('precio ya por') else 3 if r['aviso'] else 4, r['ing'], r['producto'] or ''))
    out = os.path.expanduser('~/Downloads/Recetas - factores de formato (propuesta).xlsx')
    wb = Workbook(); ws = wb.active; ws.title = 'Factores'
    cab = ['Id vínculo', 'Id producto', 'Producto', 'Proveedor', 'Ingrediente', 'Unidad', 'Último precio (€)', 'Factor propuesto', '€ por unidad resultante', 'Regla', 'Aviso', 'Referencia ingrediente (€/ud)', 'Principal', 'Factor OK / corrección']
    ws.append(cab)
    for r in filas:
        ws.append([r['vid'], r['id'], r['producto'], r['proveedor'], r['ing'], r['ud'], r['precio'], r['factor'], None if r['res'] is None else round(r['res'], 4), r['regla'], r['aviso'], None if r['mediana'] is None else round(r['mediana'], 4), 'sí' if r['principal'] else '', ''])
    for i, a in enumerate([10, 11, 52, 26, 30, 7, 12, 11, 13, 30, 46, 14, 9, 18], 1): ws.column_dimensions[get_column_letter(i)].width = a
    ws.column_dimensions['A'].hidden = True
    ws.freeze_panes = 'A2'
    t = Table(displayName='Factores', ref=f'A1:{get_column_letter(len(cab))}{len(filas)+1}'); t.tableStyleInfo = TableStyleInfo(name='TableStyleLight9', showRowStripes=True); ws.add_table(t)
    verde, amarillo, gris = PatternFill('solid', fgColor='E7EEE5'), PatternFill('solid', fgColor='FFF4CC'), PatternFill('solid', fgColor='EEEEEE')
    for i, r in enumerate(filas, 2):
        ws.cell(row=i, column=8).fill = verde if r['factor'] != 1 else (amarillo if r['regla'].startswith('precio ya por') else gris)
        if r['aviso']: ws.cell(row=i, column=11).fill = amarillo
        for c in (7, 9, 12): ws.cell(row=i, column=c).number_format = '#,##0.000'
    for c in ws[1]: c.font = Font(bold=True)
    ws2 = wb.create_sheet('Cómo revisar')
    for tx in ['Una fila por producto vinculado a un ingrediente. «Factor propuesto» = unidades del ingrediente (kg, l o ud) que trae una unidad de compra, deducido del nombre del producto.',
               '«€ por unidad resultante» = último precio ÷ factor: es lo que costará el kilo, litro o unidad en las recetas si el producto es el principal.',
               'Columna «Factor OK / corrección»: vacío = acepto el propuesto; un número = ese factor; 1 = dejarlo a 1.',
               'Orden: primero los factores propuestos con aviso (amarillo: podría ser otro factor, o el precio resultante se aleja del resto del ingrediente), luego los propuestos sin aviso, después los «precio ya por kg/l» (el nombre dice un formato pero el precio de Compras ya es por kilo o litro, así que se deja a 1) y al final los «sin dato».',
               'Cuando me devuelvas el Excel, aplico los factores en Recetas (solo cambia el coste; no toca recetas ni vínculos).']:
        ws2.append([tx])
    ws2.column_dimensions['A'].width = 130
    wb.save(out)
    n1 = sum(1 for r in filas if r['factor'] != 1); na = sum(1 for r in filas if r['factor'] != 1 and r['aviso']); ns = sum(1 for r in filas if r['regla'] == 'sin dato'); ny = sum(1 for r in filas if r['regla'].startswith('precio ya por'))
    print(f'{len(filas)} vínculos | factor propuesto ≠ 1: {n1} (con aviso {na}) | precio ya por kg/l/ud: {ny} | sin dato: {ns} | guardado en {out}')
    return filas

def aplicar(xlsx):
    from openpyxl import load_workbook
    ws = load_workbook(os.path.expanduser(xlsx), read_only=True)['Factores']
    filas = list(ws.iter_rows(values_only=True)); cab = [str(c or '').strip() for c in filas[0]]
    ci = {n: cab.index(n) for n in ['Id vínculo', 'Factor propuesto', 'Factor OK / corrección']}
    cambios = {}
    for f in filas[1:]:
        if not f or not f[ci['Id vínculo']]: continue
        prop = float(f[ci['Factor propuesto']] or 1); corr = f[ci['Factor OK / corrección']]
        factor = prop
        if corr not in (None, ''):
            try: factor = float(str(corr).replace(',', '.'))
            except ValueError: print('Corrección no numérica, se ignora:', corr); continue
        if factor > 0: cambios[f[ci['Id vínculo']]] = round(factor, 4)
    actuales = {v['id']: v['factor'] for v in fetch_all(f'rec_ingrediente_producto?cuenta_id=eq.{CUENTA}&select=id,factor')}
    n = 0
    for vid, factor in cambios.items():
        if vid in actuales and float(actuales[vid]) != factor:
            api('PATCH', f'rec_ingrediente_producto?id=eq.{vid}', {'factor': factor}, prefer='return=minimal'); n += 1
    print(f'Factores aplicados: {n} vínculos cambiados de {len(cambios)} filas leídas')

if __name__ == '__main__':
    modo = sys.argv[1] if len(sys.argv) > 1 else 'proponer'
    if modo == 'proponer': proponer()
    elif modo == 'aplicar': aplicar(sys.argv[2])
    else: raise SystemExit('modo: proponer | aplicar <xlsx>')
