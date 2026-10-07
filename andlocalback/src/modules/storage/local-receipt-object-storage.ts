import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ReceiptObjectStorage } from "./receipt-object-storage";

export class LocalReceiptObjectStorage implements ReceiptObjectStorage {
  private readonly directory = join(process.cwd(), "uploads", "receipts");

  async put(key: string, body: Buffer) {
    const filename = this.filename(key);
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, filename), body, { flag: "wx" });
  }

  async get(key: string) {
    return readFile(join(this.directory, this.filename(key)));
  }

  private filename(key: string) {
    const match = /^receipts\/([A-Za-z0-9-]+\.(?:jpg|png|webp|pdf))$/.exec(key);
    if (!match) throw new Error("Clave de comprobante invalida");
    return match[1];
  }
}
