/* PDF de una página, solo texto, sin dependencias. Lo usa el emisor simulado:
   el PDF real lo dará el proveedor de facturación. Helvetica con
   WinAnsiEncoding cubre tildes y eñes; lo que no quepa en latin1 se cambia
   por «?». */

export type PdfText = Readonly<{ x: number; y: number; size: number; text: string; bold?: boolean }>;

function escape(text: string): string {
  const latin1 = [...text].map((char) => (char.charCodeAt(0) <= 255 ? char : "?")).join("");
  return latin1.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function simplePdf(texts: readonly PdfText[]): Uint8Array {
  const stream = texts
    .map((item) => `BT /${item.bold ? "F2" : "F1"} ${item.size} Tf ${item.x} ${item.y} Td (${escape(item.text)}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
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
