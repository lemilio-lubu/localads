import { Injectable } from "@nestjs/common";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16); const derived = await scrypt(password, salt, 64) as Buffer;
    return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
  }
  async verify(password: string, stored: string): Promise<boolean> {
    const [algorithm, saltValue, hashValue] = stored.split("$");
    if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
    const expected = Buffer.from(hashValue, "base64url"); const actual = await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}

