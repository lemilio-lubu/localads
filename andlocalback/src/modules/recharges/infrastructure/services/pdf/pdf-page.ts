/* PDF de una página A4, sin dependencias: texto, rectángulos (con esquinas
   redondeadas), líneas y trazados. Las coordenadas se dan desde la esquina
   superior izquierda, como en la maqueta; el PDF las cuenta desde abajo y
   aquí se convierten. Helvetica y Courier con WinAnsiEncoding cubren tildes
   y eñes; lo que no quepa en latin1 se cambia por «?». */

import { courierWidth, helveticaWidth } from "./helvetica-metrics";

export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;

export type Rgb = Readonly<[number, number, number]>;
export type FontName = "regular" | "bold" | "mono";

const FONTS: Readonly<Record<FontName, string>> = { regular: "F1", bold: "F2", mono: "F3" };

export function hex(color: string): Rgb {
  const value = color.replace("#", "");
  return [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16) / 255) as unknown as Rgb;
}

const num = (value: number) => (Math.round(value * 1000) / 1000).toString();
const rgb = (color: Rgb) => color.map(num).join(" ");

function escape(text: string): string {
  const latin1 = [...text].map((char) => (char.charCodeAt(0) <= 255 ? char : "?")).join("");
  return latin1.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export type TextStyle = Readonly<{ size: number; font?: FontName; color?: Rgb; align?: "left" | "right" | "center" }>;

export class PdfPage {
  private readonly ops: string[] = [];

  /** Ancho del texto en puntos, para alinear a la derecha y partir líneas. */
  width(text: string, size: number, font: FontName = "regular"): number {
    return font === "mono" ? courierWidth(text, size) : helveticaWidth(text, size, font === "bold");
  }

  /** Texto en una línea; `y` es la línea base medida desde arriba. */
  text(x: number, y: number, text: string, style: TextStyle): void {
    const font = style.font ?? "regular";
    const width = this.width(text, style.size, font);
    const left = style.align === "right" ? x - width : style.align === "center" ? x - width / 2 : x;
    this.ops.push(`BT ${rgb(style.color ?? [0, 0, 0])} rg /${FONTS[font]} ${num(style.size)} Tf ${num(left)} ${num(PAGE_HEIGHT - y)} Td (${escape(text)}) Tj ET`);
  }

  /** Parte el texto en líneas que caben en `maxWidth`; una palabra demasiado larga se corta. */
  wrap(text: string, maxWidth: number, size: number, font: FontName = "regular"): string[] {
    const lines: string[] = [];
    let current = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (this.width(candidate, size, font) <= maxWidth) { current = candidate; continue; }
      if (current) lines.push(current);
      current = word;
      while (this.width(current, size, font) > maxWidth && current.length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && this.width(current.slice(0, cut), size, font) > maxWidth) cut--;
        lines.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  }

  /** Rectángulo de esquina superior izquierda (x, y); relleno, borde o ambos. */
  rect(x: number, y: number, width: number, height: number, style: Readonly<{ fill?: Rgb; stroke?: Rgb; lineWidth?: number; radius?: number }>): void {
    const bottom = PAGE_HEIGHT - y - height;
    const radius = Math.min(style.radius ?? 0, width / 2, height / 2);
    let path: string;
    if (radius <= 0) {
      path = `${num(x)} ${num(bottom)} ${num(width)} ${num(height)} re`;
    } else {
      // Cuarto de círculo con una Bézier: el punto de control va a 0,5523 del radio.
      const k = radius * 0.5523;
      const [l, r, b, t] = [x, x + width, bottom, bottom + height];
      path = [
        `${num(l + radius)} ${num(b)} m`, `${num(r - radius)} ${num(b)} l`,
        `${num(r - radius + k)} ${num(b)} ${num(r)} ${num(b + radius - k)} ${num(r)} ${num(b + radius)} c`,
        `${num(r)} ${num(t - radius)} l`,
        `${num(r)} ${num(t - radius + k)} ${num(r - radius + k)} ${num(t)} ${num(r - radius)} ${num(t)} c`,
        `${num(l + radius)} ${num(t)} l`,
        `${num(l + radius - k)} ${num(t)} ${num(l)} ${num(t - radius + k)} ${num(l)} ${num(t - radius)} c`,
        `${num(l)} ${num(b + radius)} l`,
        `${num(l)} ${num(b + radius - k)} ${num(l + radius - k)} ${num(b)} ${num(l + radius)} ${num(b)} c h`,
      ].join(" ");
    }
    const paint = style.fill && style.stroke ? "B" : style.fill ? "f" : "S";
    const colors = [style.fill ? `${rgb(style.fill)} rg` : "", style.stroke ? `${rgb(style.stroke)} RG ${num(style.lineWidth ?? 0.75)} w` : ""].filter(Boolean).join(" ");
    this.ops.push(`q ${colors} ${path} ${paint} Q`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, lineWidth = 0.75): void {
    this.ops.push(`q ${rgb(color)} RG ${num(lineWidth)} w ${num(x1)} ${num(PAGE_HEIGHT - y1)} m ${num(x2)} ${num(PAGE_HEIGHT - y2)} l S Q`);
  }

  /**
   * Trazado en coordenadas propias (y hacia abajo, como un SVG), colocado con
   * su esquina superior izquierda en (x, y) y escalado.
   */
  path(x: number, y: number, scale: number, operators: string, fill: Rgb): void {
    this.ops.push(`q ${num(scale)} 0 0 ${num(-scale)} ${num(x)} ${num(PAGE_HEIGHT - y)} cm ${rgb(fill)} rg ${operators} f Q`);
  }

  toBytes(): Uint8Array {
    const stream = this.ops.join("\n");
    const font = (base: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`;
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>`,
      font("Helvetica"),
      font("Helvetica-Bold"),
      font("Courier"),
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    ];
    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(body, "latin1"));
      body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(body, "latin1");
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(body, "latin1"));
  }
}
