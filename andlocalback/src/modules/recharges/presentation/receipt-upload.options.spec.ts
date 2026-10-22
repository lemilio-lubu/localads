import { PassThrough } from "node:stream";
import multer from "multer";
import { describe, expect, it } from "vitest";
import { receiptUploadOptions } from "./receipt-upload.options";

/* Pasa un cuerpo multipart real por multer con las opciones de los
   controladores y devuelve el nombre que reciben. */
async function originalNameOf(filename: string): Promise<string> {
  const boundary = "----localads-test";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="receipt"; filename="`),
    Buffer.from(filename, "utf8"),
    Buffer.from(`"\r\nContent-Type: image/png\r\n\r\npng\r\n--${boundary}--\r\n`),
  ]);
  const request = Object.assign(new PassThrough(), {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(body.length) },
  });
  const { limits, defParamCharset } = receiptUploadOptions;
  const upload = multer({ limits, defParamCharset, storage: multer.memoryStorage() }).single("receipt");
  const result = new Promise<string>((resolve, reject) => {
    upload(request as never, {} as never, (error?: unknown) => {
      if (error) reject(error);
      else resolve((request as unknown as { file: Express.Multer.File }).file.originalname);
    });
  });
  request.end(body);
  return result;
}

describe("subida de comprobantes", () => {
  /* Los navegadores envían el nombre en UTF-8. Multer lo leía como latin1 y
     una captura de macOS («9.14.13 PM», con U+202F antes de PM) se guardaba
     como «9.14.13â€¯PM». */
  it("conserva el nombre del archivo tal como lo envía el navegador", async () => {
    const name = "Screenshot 2026-10-20 at 9.14.13 PM.png";
    await expect(originalNameOf(name)).resolves.toBe(name);
  });

  it("conserva tildes y eñes", async () => {
    await expect(originalNameOf("transferencia año ñandú.pdf")).resolves.toBe("transferencia año ñandú.pdf");
  });
});
