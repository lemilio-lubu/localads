import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ReceiptObjectStorage } from "./receipt-object-storage";

export class R2ReceiptObjectStorage implements ReceiptObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const accountId = env.R2_ACCOUNT_ID?.trim();
    const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
    this.bucket = env.R2_BUCKET?.trim() ?? "";
    const missing = [
      ["R2_ACCOUNT_ID", accountId],
      ["R2_ACCESS_KEY_ID", accessKeyId],
      ["R2_SECRET_ACCESS_KEY", secretAccessKey],
      ["R2_BUCKET", this.bucket],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`Faltan variables de R2: ${missing.join(", ")}`);

    this.client = new S3Client({
      endpoint: env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`,
      region: env.R2_REGION?.trim() || "auto",
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      forcePathStyle: true,
    });
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.safeKey(key),
      Body: body,
      ContentType: contentType,
    }));
  }

  async get(key: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.safeKey(key) }));
    if (!result.Body) throw new Error("El objeto de R2 no tiene contenido");
    return Buffer.from(await result.Body.transformToByteArray());
  }

  private safeKey(key: string) {
    if (!/^receipts\/[0-9a-f-]{36}\.(?:jpg|png|webp|pdf)$/i.test(key)) {
      throw new Error("Clave de comprobante invalida");
    }
    return key;
  }
}
