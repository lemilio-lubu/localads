import { describe, expect, it, vi } from "vitest";
import { BrevoEmailSender, brevoFromEnvironment } from "../../infrastructure/brevo-email.sender";
import { EmailRecipient, EmailSenderPort } from "../ports/email.ports";
import { NotificationStorePort } from "../ports/notification.ports";
import { CreatedNotification, NotificationPreferenceStorePort } from "../ports/push.ports";
import { renderNotificationEmail } from "../services/notification-email.template";
import { DeliverEmailNotifications } from "./deliver-email-notifications";

const now = new Date("2026-11-25T12:00:00.000Z");
const appUrl = "https://app.andlocal.ec";

const notification = (overrides: Partial<CreatedNotification> = {}): CreatedNotification => ({
  id: "n-1", recipientUserId: "user-1", type: "payment.rejected", title: "Tu pago fue rechazado", body: "El comprobante no coincide.", linkPath: "/prepago/facturas", dedupeKey: "outbox:evt-1", ...overrides,
});
const client = (overrides: Partial<EmailRecipient> = {}): EmailRecipient => ({ userId: "user-1", role: "CLIENT", email: "migo@empresa.ec", name: "Migo", ...overrides });

function sender(send: EmailSenderPort["send"] = async () => undefined, enabled = true) {
  return { enabled, send: vi.fn(send) };
}

function preferences(email: Record<string, string[]> = {}) {
  return {
    disabledTypes: vi.fn(async () => new Map(Object.entries(email).map(([userId, types]) => [userId, { push: new Set<string>(), email: new Set(types) }]))),
    setEnabled: vi.fn(async () => undefined),
  } satisfies NotificationPreferenceStorePort;
}

function store() {
  return {
    insert: vi.fn(async () => []),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    countUnread: vi.fn(async () => 0),
    markRead: vi.fn(async () => 0),
    markPushSent: vi.fn(async () => undefined),
    markEmailSent: vi.fn(async () => undefined),
  } satisfies NotificationStorePort;
}

const channel = (mail: ReturnType<typeof sender>, recipients: EmailRecipient[], prefs = preferences(), inbox = store()) =>
  new DeliverEmailNotifications(mail, { forUsers: async () => recipients }, prefs, inbox, appUrl, () => now);

describe("canal de correo", () => {
  it("manda lo crítico del cliente a su correo, con enlace al caso, y lo marca enviado", async () => {
    const mail = sender();
    const inbox = store();
    const result = await channel(mail, [client()], preferences(), inbox).deliver([notification()]);

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: { email: "migo@empresa.ec", name: "Migo" }, subject: "Tu pago fue rechazado" }));
    expect(mail.send.mock.calls[0]![0].text).toContain("https://app.andlocal.ec/prepago/facturas");
    expect(inbox.markEmailSent).toHaveBeenCalledWith(["n-1"], now);
  });

  it("no manda por correo lo que no es crítico ni lo del equipo", async () => {
    const mail = sender();
    await channel(mail, [client(), client({ userId: "user-gestor", role: "GESTOR", email: "gestor@and.ec" })]).deliver([
      notification({ type: "recharge.completed" }),
      notification({ id: "n-2", recipientUserId: "user-gestor", type: "payment.overdue" }),
    ]);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("respeta el correo apagado", async () => {
    const mail = sender();
    const result = await channel(mail, [client()], preferences({ "user-1": ["payment.rejected"] })).deliver([notification()]);
    expect(mail.send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("dos usuarios del mismo cliente reciben un solo correo por hecho", async () => {
    const mail = sender();
    const inbox = store();
    await channel(mail, [client(), client({ userId: "user-2" })], preferences(), inbox).deliver([notification(), notification({ id: "n-2", recipientUserId: "user-2" })]);
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(inbox.markEmailSent).toHaveBeenCalledWith(["n-1", "n-2"], now);
  });

  it("cuenta el fallo del proveedor y no marca enviado", async () => {
    const inbox = store();
    const result = await channel(sender(async () => { throw new Error("Brevo HTTP 500"); }), [client()], preferences(), inbox).deliver([notification()]);
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(inbox.markEmailSent).toHaveBeenCalledWith([], now);
  });

  it("sin proveedor configurado no consulta nada", async () => {
    const forUsers = vi.fn(async () => [client()]);
    const result = await new DeliverEmailNotifications(sender(undefined, false), { forUsers }, preferences(), store(), appUrl, () => now).deliver([notification()]);
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(forUsers).not.toHaveBeenCalled();
  });
});

describe("plantilla del correo", () => {
  it("escapa el texto que escribe una persona", () => {
    const email = renderNotificationEmail({ title: "Tu pago <b>fue</b> rechazado", body: `<script>alert("x")</script>`, url: "https://app.andlocal.ec/prepago/facturas?a=1&b=2" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("Tu pago &lt;b&gt;fue&lt;/b&gt; rechazado");
    expect(email.html).toContain("a=1&amp;b=2");
    expect(email.text).toContain(`<script>alert("x")</script>`);
  });

  it("sin enlace no pone botón", () => {
    expect(renderNotificationEmail({ title: "Aviso", body: "Texto", url: null }).html).not.toContain("<a ");
  });
});

describe("Brevo", () => {
  const config = { apiKey: "xkeysib-prueba", senderEmail: "avisos@and.ec", senderName: "AND Local Ads" };
  const message = { to: { email: "migo@empresa.ec", name: "Migo" }, subject: "Asunto", text: "Texto", html: "<p>Texto</p>" };

  it("sin clave o sin remitente queda apagado", () => {
    expect(brevoFromEnvironment({ BREVO_API_KEY: "k" })).toBeNull();
    expect(brevoFromEnvironment({ NOTIFICATIONS_EMAIL_FROM: "avisos@and.ec" })).toBeNull();
    expect(new BrevoEmailSender(null).enabled).toBe(false);
    expect(brevoFromEnvironment({ BREVO_API_KEY: "k", NOTIFICATIONS_EMAIL_FROM: "avisos@and.ec" })).toEqual({ apiKey: "k", senderEmail: "avisos@and.ec", senderName: "AND Local Ads" });
  });

  it("llama a la API de Brevo con la clave en la cabecera", async () => {
    const http = vi.fn(async () => new Response(JSON.stringify({ messageId: "<id>" }), { status: 201 }));
    await new BrevoEmailSender(config, http as unknown as typeof fetch).send(message);
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-prueba");
    expect(JSON.parse(String(init.body))).toMatchObject({ sender: { email: "avisos@and.ec" }, to: [{ email: "migo@empresa.ec" }], subject: "Asunto", textContent: "Texto" });
  });

  it("una respuesta de error lanza para que el canal lo cuente", async () => {
    const http = vi.fn(async () => new Response(JSON.stringify({ code: "unauthorized" }), { status: 401 }));
    await expect(new BrevoEmailSender(config, http as unknown as typeof fetch).send(message)).rejects.toThrow("Brevo HTTP 401");
  });
});
