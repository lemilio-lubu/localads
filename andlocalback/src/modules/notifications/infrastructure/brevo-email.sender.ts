import { Logger } from "@nestjs/common";
import { EmailMessage, EmailSenderPort } from "../application/ports/email.ports";

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const TIMEOUT_MS = 10_000;

type BrevoConfig = Readonly<{ apiKey: string; senderEmail: string; senderName: string }>;

/* Brevo por su API HTTPS (Railway bloquea SMTP fuera del plan Pro). Plan
   gratis: 300 correos al día. El remitente tiene que ser de un dominio
   verificado en Brevo (SPF/DKIM/DMARC); si no, Brevo lo cambia por uno suyo.
   Sin clave o sin remitente, el correo queda apagado y la bandeja sigue. */
export function brevoFromEnvironment(env: NodeJS.ProcessEnv = process.env): BrevoConfig | null {
  const apiKey = env.BREVO_API_KEY?.trim();
  const senderEmail = env.NOTIFICATIONS_EMAIL_FROM?.trim();
  if (!apiKey || !senderEmail) return null;
  return { apiKey, senderEmail, senderName: env.NOTIFICATIONS_EMAIL_FROM_NAME?.trim() || "AND Local Ads" };
}

/* Se crea con useFactory en el módulo: recibe su configuración y su fetch, así el test no sale a la red. */
export class BrevoEmailSender implements EmailSenderPort {
  private readonly logger = new Logger(BrevoEmailSender.name);

  constructor(private readonly config: BrevoConfig | null = brevoFromEnvironment(), private readonly http: typeof fetch = fetch) {}

  get enabled(): boolean {
    return this.config !== null;
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.config) throw new Error("Correo sin configurar");
    const response = await this.http(BREVO_URL, {
      method: "POST",
      headers: { "api-key": this.config.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: this.config.senderEmail, name: this.config.senderName },
        to: [{ email: message.to.email, name: message.to.name }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        tags: ["aviso"],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      /* Sin el destinatario ni el contenido en el log: solo el estado y el código de Brevo. */
      const detail = await response.json().then((body: { code?: unknown }) => (typeof body.code === "string" ? ` ${body.code}` : "")).catch(() => "");
      this.logger.warn(`Brevo rechazó un correo (HTTP ${response.status}${detail})`);
      throw new Error(`Brevo HTTP ${response.status}`);
    }
  }
}
