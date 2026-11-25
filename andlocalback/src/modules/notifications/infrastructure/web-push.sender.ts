import { Injectable, Logger } from "@nestjs/common";
import webPush, { WebPushError } from "web-push";
import { PushPayload, PushSendOutcome, PushSenderPort, StoredPushSubscription } from "../application/ports/push.ports";

const TIMEOUT_MS = 10_000;
/* Si el dispositivo está apagado, el servicio push guarda el aviso un día;
   después ya no tiene sentido. */
const TTL_SECONDS = 24 * 60 * 60;

type VapidDetails = Readonly<{ subject: string; publicKey: string; privateKey: string }>;

/* Web Push estándar (VAPID): gratis, sin cuenta en ningún proveedor. Las
   claves salen de `npx web-push generate-vapid-keys` y viven solo en las
   variables de entorno. Sin ellas, el push queda apagado y la bandeja sigue. */
export function vapidFromEnvironment(env: NodeJS.ProcessEnv = process.env): VapidDetails | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  /* Los servicios push exigen un contacto: mailto: o una URL https. El origen
     del frontend sirve en producción; en local es http y no vale. */
  const origin = env.FRONTEND_ORIGIN?.trim();
  const subject = env.VAPID_SUBJECT?.trim() || (origin?.startsWith("https://") ? origin : "mailto:soporte@andlocal.app");
  return { subject, publicKey, privateKey };
}

@Injectable()
export class WebPushSender implements PushSenderPort {
  private readonly logger = new Logger(WebPushSender.name);
  private readonly vapid = vapidFromEnvironment();
  readonly publicKey = this.vapid?.publicKey ?? null;

  async send(subscription: StoredPushSubscription, payload: PushPayload): Promise<PushSendOutcome> {
    if (!this.vapid) throw new Error("Push sin claves VAPID");
    try {
      await webPush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        { vapidDetails: this.vapid, TTL: TTL_SECONDS, timeout: TIMEOUT_MS, urgency: "normal" },
      );
      return "sent";
    } catch (error) {
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return "gone";
      /* Sin el endpoint ni el cuerpo: el endpoint identifica al dispositivo. */
      const status = error instanceof WebPushError ? ` (HTTP ${error.statusCode})` : "";
      this.logger.warn(`Envío push fallido${status}: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
      throw error;
    }
  }
}
