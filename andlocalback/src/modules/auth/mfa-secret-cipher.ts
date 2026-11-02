import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isDeployed } from "../../common/config/environment";

/* El secreto TOTP no puede guardarse en claro: quien lea la base podria
   generar codigos validos. Va con AES-256-GCM y una clave que vive fuera de
   la base (MFA_ENCRYPTION_KEY, 32 bytes en base64). Separada del secreto JWT a
   proposito: rotar uno no debe obligar a nadie a volver a activar el doble factor. */
@Injectable()
export class MfaSecretCipher {
  private readonly key: Buffer;

  /* Sin parametros en el constructor: Nest lo crea solo. Los tests pasan el
     entorno con fromEnv. */
  constructor() { this.key = MfaSecretCipher.keyFrom(process.env); }

  static fromEnv(env: NodeJS.ProcessEnv): MfaSecretCipher {
    return Object.assign(Object.create(MfaSecretCipher.prototype) as MfaSecretCipher, { key: MfaSecretCipher.keyFrom(env) });
  }

  private static keyFrom(env: NodeJS.ProcessEnv): Buffer {
    const raw = env.MFA_ENCRYPTION_KEY?.trim();
    if (raw) {
      const key = Buffer.from(raw, "base64");
      if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY debe ser de 32 bytes en base64");
      return key;
    }
    if (isDeployed(env)) throw new Error("MFA_ENCRYPTION_KEY es obligatoria en un despliegue");
    return createHash("sha256").update("development-only-mfa-key").digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return `v1.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
  }

  decrypt(stored: string): string {
    const [version, data] = stored.split(".");
    if (version !== "v1" || !data) throw new Error("MFA_SECRET_FORMAT");
    const bytes = Buffer.from(data, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  }
}
