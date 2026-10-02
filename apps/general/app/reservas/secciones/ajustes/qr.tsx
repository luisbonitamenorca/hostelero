"use client";

/* Generador de códigos QR como SVG, sin dependencias (modo bytes, corrección M, versiones 1–10:
   hasta 213 bytes, de sobra para el enlace del widget). Implementa ISO/IEC 18004: Reed-Solomon
   sobre GF(256), colocación en zigzag, las 8 máscaras con penalización y la información de
   formato/versión. Validado contra la librería «qrcode» (ver dudas de la entrega). */

/* ---- tablas por versión (corrección M) ---- */
// [capacidad en bytes, codewords de corrección por bloque, bloques: [n, total, datos][]]
const VERSIONES: { cap: number; ec: number; bloques: [number, number, number][] }[] = [
  { cap: 14, ec: 10, bloques: [[1, 26, 16]] },
  { cap: 26, ec: 16, bloques: [[1, 44, 28]] },
  { cap: 42, ec: 26, bloques: [[1, 70, 44]] },
  { cap: 62, ec: 18, bloques: [[2, 50, 32]] },
  { cap: 84, ec: 24, bloques: [[2, 67, 43]] },
  { cap: 106, ec: 16, bloques: [[4, 43, 27]] },
  { cap: 122, ec: 18, bloques: [[4, 49, 31]] },
  { cap: 152, ec: 22, bloques: [[2, 60, 38], [2, 61, 39]] },
  { cap: 180, ec: 22, bloques: [[3, 58, 36], [2, 59, 37]] },
  { cap: 213, ec: 26, bloques: [[4, 69, 43], [1, 70, 44]] },
];
const ALINEACION: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

/* ---- GF(256) con polinomio 0x11D ---- */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generador(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const nuevo = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      nuevo[j] ^= g[j];
      nuevo[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = nuevo;
  }
  return g;
}

function reedSolomon(datos: number[], nEc: number): number[] {
  const g = generador(nEc);
  const resto = new Array<number>(nEc).fill(0);
  for (const d of datos) {
    const factor = d ^ resto[0];
    resto.shift();
    resto.push(0);
    if (factor !== 0) for (let j = 0; j < nEc; j++) resto[j] ^= mul(g[j + 1], factor);
  }
  return resto;
}

/* ---- BCH para formato y versión ---- */
function bch(valor: number, bits: number, poli: number, grado: number): number {
  let v = valor << grado;
  for (let i = bits - 1; i >= grado; i--) if (v & (1 << i)) v ^= poli << (i - grado);
  return (valor << grado) | v;
}
const infoFormato = (mascara: number) => bch((0b00 << 3) | mascara, 15, 0x537, 10) ^ 0x5412; // nivel M = 00
const infoVersion = (v: number) => bch(v, 18, 0x1f25, 12);

/* ---- codificación de los datos ---- */
function codificar(bytes: Uint8Array): { version: number; codewords: number[] } {
  const vi = VERSIONES.findIndex((v) => v.cap >= bytes.length);
  if (vi < 0) throw new Error("Texto demasiado largo para el QR");
  const version = vi + 1;
  const spec = VERSIONES[vi];
  const totalDatos = spec.bloques.reduce((a, [n, , d]) => a + n * d, 0);
  const bits: number[] = [];
  const push = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, totalDatos * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const datos: number[] = [];
  for (let i = 0; i < bits.length; i += 8) datos.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let k = 0; datos.length < totalDatos; k++) datos.push(k % 2 ? 0x11 : 0xec);

  // bloques e intercalado
  const bloquesDatos: number[][] = [];
  const bloquesEc: number[][] = [];
  let pos = 0;
  for (const [n, , d] of spec.bloques) {
    for (let i = 0; i < n; i++) {
      const b = datos.slice(pos, pos + d);
      pos += d;
      bloquesDatos.push(b);
      bloquesEc.push(reedSolomon(b, spec.ec));
    }
  }
  const out: number[] = [];
  const maxD = Math.max(...bloquesDatos.map((b) => b.length));
  for (let i = 0; i < maxD; i++) for (const b of bloquesDatos) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < spec.ec; i++) for (const b of bloquesEc) out.push(b[i]);
  return { version, codewords: out };
}

/* ---- matriz ---- */
type Matriz = { n: number; mod: Uint8Array; fijo: Uint8Array };

function base(version: number): Matriz {
  const n = version * 4 + 17;
  const mod = new Uint8Array(n * n);
  const fijo = new Uint8Array(n * n);
  const poner = (x: number, y: number, v: number) => { if (x >= 0 && y >= 0 && x < n && y < n) { mod[y * n + x] = v; fijo[y * n + x] = 1; } };
  const buscador = (cx: number, cy: number) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      poner(cx + dx, cy + dy, d === 2 || d === 4 ? 0 : 1);
    }
  };
  buscador(0, 0);
  buscador(n - 7, 0);
  buscador(0, n - 7);
  // reservas de formato (se escriben en aplicar()) y módulo oscuro; después el patrón de tiempo
  // pasa por encima (fila y columna 6 son suyas).
  for (let i = 0; i < 9; i++) { poner(i, 8, 0); poner(8, i, 0); }
  for (let i = 0; i < 8; i++) { poner(n - 1 - i, 8, 0); poner(8, n - 1 - i, 0); }
  poner(8, n - 8, 1);
  for (let i = 8; i < n - 8; i++) { poner(i, 6, i % 2 === 0 ? 1 : 0); poner(6, i, i % 2 === 0 ? 1 : 0); }
  // patrones de alineación: todos salvo los tres que pisarían un buscador
  const al = ALINEACION[version - 1];
  for (const cy of al) for (const cx of al) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === n - 7) || (cx === n - 7 && cy === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) poner(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) === 1 ? 0 : 1);
  }
  if (version >= 7) {
    const info = infoVersion(version);
    for (let i = 0; i < 18; i++) {
      const bit = (info >> i) & 1;
      poner(Math.floor(i / 3), n - 11 + (i % 3), bit);
      poner(n - 11 + (i % 3), Math.floor(i / 3), bit);
    }
  }
  return { n, mod, fijo };
}

function colocar(m: Matriz, codewords: number[]) {
  const { n, mod, fijo } = m;
  let idx = 0;
  const total = codewords.length * 8;
  for (let der = n - 1; der >= 1; der -= 2) {
    if (der === 6) der = 5;
    for (let k = 0; k < n; k++) {
      const arriba = ((der + 1) & 2) === 0;
      const y = arriba ? n - 1 - k : k;
      for (let dx = 0; dx < 2; dx++) {
        const x = der - dx;
        if (fijo[y * n + x]) continue;
        const bit = idx < total ? (codewords[idx >> 3] >> (7 - (idx & 7))) & 1 : 0;
        mod[y * n + x] = bit;
        idx++;
      }
    }
  }
}

const MASCARAS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function aplicar(m: Matriz, k: number): Uint8Array {
  const { n, mod, fijo } = m;
  const out = new Uint8Array(mod);
  const f = MASCARAS[k];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fijo[y * n + x] && f(x, y)) out[y * n + x] ^= 1;
  // Información de formato (15 bits, el bit 0 es el menos significativo), dos copias.
  const info = infoFormato(k);
  for (let i = 0; i < 15; i++) {
    const bit = (info >> i) & 1;
    // vertical, columna 8: filas 0–5, 7–8 y las 7 últimas
    const fila = i < 6 ? i : i < 8 ? i + 1 : n - 15 + i;
    out[fila * n + 8] = bit;
    // horizontal, fila 8: las 8 últimas columnas, la 7 y las columnas 5–0
    const col = i < 8 ? n - 1 - i : i === 8 ? 7 : 14 - i;
    out[8 * n + col] = bit;
  }
  return out;
}

function penalizacion(n: number, m: Uint8Array): number {
  let p = 0;
  const at = (x: number, y: number) => m[y * n + x];
  // 1: rachas de 5+ en filas y columnas
  for (let y = 0; y < n; y++) {
    let r = 1, c = 1;
    for (let x = 1; x < n; x++) {
      if (at(x, y) === at(x - 1, y)) { r++; if (r === 5) p += 3; else if (r > 5) p++; } else r = 1;
      if (at(y, x) === at(y, x - 1)) { c++; if (c === 5) p += 3; else if (c > 5) p++; } else c = 1;
    }
  }
  // 2: bloques 2×2
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const v = at(x, y);
    if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) p += 3;
  }
  // 3: patrón 1011101 con 4 claros a un lado
  const patron = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const coincide = (get: (i: number) => number, inicio: number, inv: boolean) => {
    for (let i = 0; i < 11; i++) if (get(inicio + i) !== patron[inv ? 10 - i : i]) return false;
    return true;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x <= n - 11; x++) {
    if (coincide((i) => at(i, y), x, false) || coincide((i) => at(i, y), x, true)) p += 40;
    if (coincide((i) => at(y, i), x, false) || coincide((i) => at(y, i), x, true)) p += 40;
  }
  // 4: proporción de oscuros
  let oscuros = 0;
  for (let i = 0; i < m.length; i++) oscuros += m[i];
  const pct = (oscuros * 100) / m.length;
  p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

/** Matriz de módulos (true = oscuro) del QR para un texto UTF-8. */
export function matrizQr(texto: string): boolean[][] {
  const bytes = new TextEncoder().encode(texto);
  const { version, codewords } = codificar(bytes);
  const m = base(version);
  colocar(m, codewords);
  let mejor: Uint8Array | null = null;
  let mejorP = Infinity;
  for (let k = 0; k < 8; k++) {
    const cand = aplicar(m, k);
    const p = penalizacion(m.n, cand);
    if (p < mejorP) { mejorP = p; mejor = cand; }
  }
  const n = m.n;
  const out: boolean[][] = [];
  for (let y = 0; y < n; y++) {
    const fila: boolean[] = [];
    for (let x = 0; x < n; x++) fila.push(mejor![y * n + x] === 1);
    out.push(fila);
  }
  return out;
}

/** SVG del QR como cadena (para descargar). `margen` en módulos. */
export function svgQr(texto: string, opciones?: { margen?: number; color?: string; fondo?: string }): string {
  const mat = matrizQr(texto);
  const n = mat.length;
  const margen = opciones?.margen ?? 2;
  const total = n + margen * 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (mat[y][x]) d += `M${x + margen} ${y + margen}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${opciones?.fondo ?? "#ffffff"}"/><path d="${d}" fill="${opciones?.color ?? "#000000"}"/></svg>`;
}

/** Componente: el QR renderizado en línea. */
export function QrSvg({ texto, tamano = 168, color = "#111111" }: { texto: string; tamano?: number; color?: string }) {
  let mat: boolean[][];
  try {
    mat = matrizQr(texto);
  } catch {
    return <div className="aj-vacio">Enlace demasiado largo para el QR.</div>;
  }
  const n = mat.length;
  const margen = 2;
  const total = n + margen * 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (mat[y][x]) d += `M${x + margen} ${y + margen}h1v1h-1z`;
  return (
    <svg viewBox={`0 0 ${total} ${total}`} width={tamano} height={tamano} shapeRendering="crispEdges" role="img" aria-label="Código QR del enlace de reservas">
      <rect width={total} height={total} fill="#ffffff" />
      <path d={d} fill={color} />
    </svg>
  );
}
