/* Código de barras Code 128, el que usa el RIDE para la clave de acceso.
   Una cadena de dígitos se codifica de dos en dos (juego C); si el número de
   dígitos es impar, el último va en el juego B. Cada símbolo son tres barras
   y tres espacios que suman 11 módulos; la parada, 13. */

const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232",
] as const;
const STOP = "2331112";
const START_C = 105;
const CODE_B = 100;

export const CODE128_PATTERNS = PATTERNS;

/** Valores de los símbolos (sin la parada), con el dígito de control al final. */
export function code128Values(digits: string): number[] {
  if (!/^\d+$/.test(digits)) throw new Error("Code 128 C: solo dígitos");
  const values = [START_C];
  const even = digits.length - (digits.length % 2);
  for (let index = 0; index < even; index += 2) values.push(Number(digits.slice(index, index + 2)));
  if (even < digits.length) values.push(CODE_B, digits.charCodeAt(even) - 32);
  const checksum = values.reduce((sum, value, index) => sum + value * (index === 0 ? 1 : index), 0) % 103;
  return [...values, checksum];
}

/** Barras como [inicio, ancho] en módulos, y el ancho total en módulos. */
export function code128Bars(digits: string): { bars: [number, number][]; modules: number } {
  const widths = [...code128Values(digits).map((value) => PATTERNS[value]), STOP].join("");
  const bars: [number, number][] = [];
  let position = 0;
  [...widths].forEach((char, index) => {
    const width = Number(char);
    if (index % 2 === 0) bars.push([position, width]);
    position += width;
  });
  return { bars, modules: position };
}
