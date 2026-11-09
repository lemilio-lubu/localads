/* Anchos de Helvetica y Helvetica-Bold (AFM de Adobe, milésimas del cuerpo)
   para los caracteres 32–126. Una letra con tilde mide lo mismo que la base
   (á como a, Ñ como N), igual que en las métricas originales. */

const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/* Fuera de ASCII y sin letra base: lo que aparece en una factura. */
const EXTRA: Readonly<Record<string, number>> = { "·": 278, "º": 365, "ª": 370, "°": 400, "¿": 611, "¡": 333 };

function charWidth(char: string, bold: boolean): number {
  const table = bold ? BOLD : REGULAR;
  const base = char.normalize("NFD")[0];
  const code = base.charCodeAt(0);
  if (code >= 32 && code <= 126) return table[code - 32];
  return EXTRA[char] ?? 556;
}

export function helveticaWidth(text: string, size: number, bold: boolean): number {
  let total = 0;
  for (const char of text) total += charWidth(char, bold);
  return (total * size) / 1000;
}

/** Courier es monoespaciada: 600 milésimas por carácter. */
export const courierWidth = (text: string, size: number) => ([...text].length * 600 * size) / 1000;
