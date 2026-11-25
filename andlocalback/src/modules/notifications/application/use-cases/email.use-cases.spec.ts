import { describe, expect, it, vi } from "vitest";
import { BrevoEmailSender, brevoFromEnvironment } from "../../infrastructure/brevo-email.sender";
import { ecuadorDayKey } from "../../../../common/time/ecuador-day";
import { emailDailyLimitFromEnvironment, nextEmailRetryAt } from "../../domain/email-health";
import { EmailCandidate, EmailDeliveryStorePort, EmailRecipient, EmailSenderPort, EmailUsagePort } from "../ports/email.ports";
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

function deliveries(pending: EmailCandidate[] = []) {
  return {
    markSent: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    cancelRetry: vi.fn(async () => undefined),
    claimRetries: vi.fn(async () => pending),
  } satisfies EmailDeliveryStorePort;
}

function usage(totals = { sent: 1, failed: 0 }) {
  return {
    record: vi.fn(async () => totals),
    raiseAlert: vi.fn(async () => true),
  } satisfies EmailUsagePort;
}

const channel = (mail: ReturnType<typeof sender>, recipients: EmailRecipient[], prefs = preferences(), store = deliveries(), counter = usage(), dailyLimit = 300) =>
  new DeliverEmailNotifications(mail, { forUsers: async () => recipients }, prefs, store, counter, { appUrl, dailyLimit }, () => now);

describe("canal de correo", () => {
  it("manda lo crítico del cliente a su correo, con enlace al caso, y lo marca enviado", async () => {
    const mail = sender();
    const store = deliveries();
    const counter = usage();
    const result = await channel(mail, [client()], preferences(), store, counter).deliver([notification()]);

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: { email: "migo@empresa.ec", name: "Migo" }, subject: "Tu pago fue rechazado" }));
    expect(mail.send.mock.calls[0]![0].text).toContain("https://app.andlocal.ec/prepago/facturas");
    expect(store.markSent).toHaveBeenCalledWith(["n-1"], now);
    expect(counter.record).toHaveBeenCalledWith("2026-11-25", 1, 0);
  });

  it("no manda por correo lo que no es crítico ni lo del equipo", async () => {
    const mail = sender();
    await channel(mail, [client(), client({ userId: "user-gestor", role: "GESTOR", email: "gestor@and.ec" })]).deliver([
      notification({ type: "recharge.completed" }),
      notification({ type: "payment.due_soon" }),
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
    const store = deliveries();
    await channel(mail, [client(), client({ userId: "user-2" })], preferences(), store).deliver([notification(), notification({ id: "n-2", recipientUserId: "user-2" })]);
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(store.markSent).toHaveBeenCalledWith(["n-1", "n-2"], now);
  });

  it("un fallo del proveedor no se pierde: queda para reintentar en un minuto", async () => {
    const store = deliveries();
    const result = await channel(sender(async () => { throw new Error("Brevo HTTP 500"); }), [client()], preferences(), store).deliver([notification()]);
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(store.markSent).toHaveBeenCalledWith([], now);
    expect(store.markFailed).toHaveBeenCalledWith(["n-1"], new Date(now.getTime() + 60_000));
  });

  it("reintenta lo pendiente con espera creciente y lo abandona tras el último intento", async () => {
    const store = deliveries([{ ...notification(), emailAttempts: 2 }, { ...notification({ id: "n-9", dedupeKey: "outbox:evt-9" }), emailAttempts: 5 }]);
    const failing = sender(async () => { throw new Error("Brevo HTTP 429"); });
    await channel(failing, [client()], preferences(), store).retryPending();
    expect(store.claimRetries).toHaveBeenCalledWith(now, new Date(now.getTime() + 10 * 60_000), 50);
    expect(store.markFailed).toHaveBeenCalledWith(["n-1"], new Date(now.getTime() + 60 * 60_000));
    expect(store.markFailed).toHaveBeenCalledWith(["n-9"], null);
  });

  it("un reintento que ya no toca sale de la cola sin mandarse", async () => {
    const mail = sender();
    const store = deliveries([{ ...notification(), emailAttempts: 1 }]);
    await channel(mail, [client()], preferences({ "user-1": ["payment.rejected"] }), store).retryPending();
    expect(mail.send).not.toHaveBeenCalled();
    expect(store.cancelRetry).toHaveBeenCalledWith(["n-1"]);
  });

  it("al llegar al 80 % del límite diario avisa a los admins", async () => {
    const counter = usage({ sent: 240, failed: 0 });
    await channel(sender(), [client()], preferences(), deliveries(), counter).deliver([notification()]);
    expect(counter.raiseAlert).toHaveBeenCalledWith("2026-11-25", "quota", { type: "email.quota_warning", day: "2026-11-25", sent: 240, limit: 300 });
    expect(counter.raiseAlert).toHaveBeenCalledTimes(1);
  });

  it("con muchos fallos en el día avisa que el correo está fallando", async () => {
    const counter = usage({ sent: 3, failed: 10 });
    await channel(sender(async () => { throw new Error("Brevo HTTP 401"); }), [client()], preferences(), deliveries(), counter).deliver([notification()]);
    expect(counter.raiseAlert).toHaveBeenCalledWith("2026-11-25", "failures", { type: "email.delivery_failing", day: "2026-11-25", failed: 10 });
  });

  it("si la cuenta del día falla, el correo igual queda enviado", async () => {
    const counter = { record: vi.fn(async () => { throw new Error("db"); }), raiseAlert: vi.fn(async () => true) };
    const result = await channel(sender(), [client()], preferences(), deliveries(), counter).deliver([notification()]);
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it("sin proveedor configurado no consulta nada", async () => {
    const forUsers = vi.fn(async () => [client()]);
    const store = deliveries();
    const disabled = new DeliverEmailNotifications(sender(undefined, false), { forUsers }, preferences(), store, usage(), { appUrl, dailyLimit: 300 }, () => now);
    expect(await disabled.deliver([notification()])).toEqual({ sent: 0, failed: 0 });
    expect(await disabled.retryPending()).toEqual({ sent: 0, failed: 0 });
    expect(forUsers).not.toHaveBeenCalled();
    expect(store.claimRetries).not.toHaveBeenCalled();
  });
});

describe("reintentos y alertas", () => {
  it("las esperas suman algo más de un día y luego se abandona", () => {
    expect(nextEmailRetryAt(1, now)).toEqual(new Date(now.getTime() + 60_000));
    expect(nextEmailRetryAt(5, now)).toEqual(new Date(now.getTime() + 24 * 3_600_000));
    expect(nextEmailRetryAt(6, now)).toBeNull();
  });

  it("el límite diario se lee del entorno y si no, es el del plan gratis", () => {
    expect(emailDailyLimitFromEnvironment({})).toBe(300);
    expect(emailDailyLimitFromEnvironment({ NOTIFICATIONS_EMAIL_DAILY_LIMIT: "5000" })).toBe(5000);
    expect(emailDailyLimitFromEnvironment({ NOTIFICATIONS_EMAIL_DAILY_LIMIT: "mucho" })).toBe(300);
  });

  it("el día se cuenta en hora de Ecuador", () => {
    expect(ecuadorDayKey(new Date("2026-11-26T04:59:00.000Z"))).toBe("2026-11-25");
    expect(ecuadorDayKey(new Date("2026-11-26T05:00:00.000Z"))).toBe("2026-11-26");
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
