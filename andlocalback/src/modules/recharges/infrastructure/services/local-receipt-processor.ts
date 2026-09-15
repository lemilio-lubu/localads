import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApplicationError } from "../../../../common/errors/application.error";
import { ReceiptProcessor } from "../../application/ports/recharge.ports";
import { ReceiptUpload } from "../../domain/recharge.types";

const maxReceiptSize = 5 * 1024 * 1024;
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const extensionsByType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

function hasValidSignature(upload: ReceiptUpload) {
  const bytes = upload.buffer;
  if (upload.mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (upload.mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (upload.mimeType === "image/webp") return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (upload.mimeType === "application/pdf") return bytes.subarray(0, 4).toString() === "%PDF";
  return false;
}

export class LocalReceiptProcessor implements ReceiptProcessor {
  async process(upload: ReceiptUpload) {
    if (!upload.buffer.length || upload.size <= 0) {
      throw new ApplicationError("EMPTY_RECEIPT", "El comprobante está vacío");
    }
    if (upload.size > maxReceiptSize) {
      throw new ApplicationError("RECEIPT_TOO_LARGE", "El comprobante supera el límite de 5 MB");
    }
    if (!supportedTypes.has(upload.mimeType) || !hasValidSignature(upload)) {
      throw new ApplicationError("INVALID_RECEIPT", "El comprobante debe ser PNG, JPG, WEBP o PDF válido");
    }

    const id = randomUUID();
    const safeExtension = extensionsByType[upload.mimeType];
    const fileName = `${id}${safeExtension}`;
    const directory = join(process.cwd(), "uploads", "receipts");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, fileName), upload.buffer);

    return {
      id,
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      size: upload.size,
      url: `/uploads/receipts/${fileName}`,
      checksum: createHash("sha256").update(upload.buffer).digest("hex"),
    };
  }
}
