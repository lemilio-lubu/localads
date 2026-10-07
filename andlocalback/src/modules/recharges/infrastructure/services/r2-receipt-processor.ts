import { createHash, randomUUID } from "node:crypto";
import { ApplicationError } from "../../../../common/errors/application.error";
import { ReceiptProcessor } from "../../application/ports/recharge.ports";
import { ReceiptUpload } from "../../domain/recharge.types";
import { ReceiptObjectStorage } from "../../../storage/receipt-object-storage";

const maxReceiptSize = 5 * 1024 * 1024;
const extensionsByType: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf",
};

function hasValidSignature(upload: ReceiptUpload) {
  const bytes = upload.buffer;
  if (upload.mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (upload.mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (upload.mimeType === "image/webp") return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (upload.mimeType === "application/pdf") return bytes.subarray(0, 4).toString() === "%PDF";
  return false;
}

export class R2ReceiptProcessor implements ReceiptProcessor {
  constructor(private readonly storage: ReceiptObjectStorage) {}

  async process(upload: ReceiptUpload) {
    if (!upload.buffer.length || upload.size !== upload.buffer.length) throw new ApplicationError("EMPTY_RECEIPT", "El comprobante está vacío o no es válido");
    if (upload.buffer.length > maxReceiptSize) throw new ApplicationError("RECEIPT_TOO_LARGE", "El comprobante supera el límite de 5 MB");
    const extension = extensionsByType[upload.mimeType];
    if (!extension || !hasValidSignature(upload)) {
      throw new ApplicationError("INVALID_RECEIPT", "El comprobante debe ser PNG, JPG, WEBP o PDF válido");
    }

    const key = `receipts/${randomUUID()}${extension}`;
    await this.storage.put(key, upload.buffer, upload.mimeType);
    return {
      id: key.slice("receipts/".length, -extension.length),
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      size: upload.buffer.length,
      url: `r2://${key}`,
      checksum: createHash("sha256").update(upload.buffer).digest("hex"),
    };
  }
}
