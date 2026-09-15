import { randomUUID } from "node:crypto";
import { IdGenerator } from "../../application/ports/recharge.ports";

export class CryptoIdGenerator implements IdGenerator {
  generate() {
    return randomUUID();
  }
}
