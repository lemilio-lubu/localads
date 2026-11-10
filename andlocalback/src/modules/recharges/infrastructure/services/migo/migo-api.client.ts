import {
  MigoCustomer,
  MigoCustomerRequest,
  MigoErrorBody,
  MigoInvoiceRequest,
  MigoInvoiceResponse,
  MigoLookup,
  MigoPage,
} from "./migo-api.types";

export type MigoClientConfig = Readonly<{
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
}>;

/* Lo que se descuenta a la vida del token para no usarlo justo cuando vence. */
const TOKEN_MARGIN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Error de Migo con su código de aplicación (TOTALS_MISMATCH, FORBIDDEN…). status 0: no hubo respuesta. */
export class MigoApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "MigoApiError";
  }
}

/**
 * Cliente de la API REST v1 de Migo. Autenticación OAuth2 client_credentials:
 * el token dura una hora y Migo solo deja pedir 10 por hora por credencial,
 * así que se guarda en memoria, se pide uno solo aunque lleguen varias
 * peticiones a la vez y se renueva una vez si Migo responde 401.
 *
 * Los mensajes de error nunca incluyen las credenciales ni el token.
 */
export class MigoApiClient {
  private token: Readonly<{ value: string; expiresAt: number }> | null = null;
  private pendingToken: Promise<string> | null = null;
  private readonly baseUrl: string;

  constructor(
    private readonly config: MigoClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  /* Busca por RUC exacto: el parámetro search de Migo también encuentra
     coincidencias parciales y por nombre. */
  async findCustomerByIdentification(identification: string): Promise<MigoCustomer | null> {
    const query = new URLSearchParams({ search: identification, includeInactive: "true", page: "0", size: "50" });
    const page = await this.request<MigoPage<MigoCustomer>>("GET", `/api/v1/customers?${query}`);
    return page.data.find((customer) => customer.identificationNumber === identification) ?? null;
  }

  createCustomer(customer: MigoCustomerRequest): Promise<MigoCustomer> {
    return this.request<MigoCustomer>("POST", "/api/v1/customers", customer);
  }

  createInvoice(invoice: MigoInvoiceRequest): Promise<MigoInvoiceResponse> {
    return this.request<MigoInvoiceResponse>("POST", "/api/v1/invoices", invoice);
  }

  getInvoice(id: string): Promise<MigoInvoiceResponse> {
    return this.request<MigoInvoiceResponse>("GET", `/api/v1/invoices/${encodeURIComponent(id)}`);
  }

  /* Los plazos de pago de la empresa (Crédito 30 días…): la forma de pago
     «Cliente (Crédito)» no se acepta sin uno. */
  listPaymentTerms(): Promise<MigoLookup[]> {
    return this.request<MigoLookup[]>("GET", "/api/v1/payment-terms/options");
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, renewed = false): Promise<T> {
    const token = await this.accessToken();
    const response = await this.send(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401 && !renewed) {
      this.token = null;
      return this.request<T>(method, path, body, true);
    }
    if (!response.ok) throw await errorFrom(response, `${method} ${path.split("?")[0]}`);
    return (await response.json()) as T;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_MARGIN_MS > this.now()) return this.token.value;
    this.pendingToken ??= this.requestToken().finally(() => { this.pendingToken = null; });
    return this.pendingToken;
  }

  private async requestToken(): Promise<string> {
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const response = await this.send(`${this.baseUrl}/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    });
    if (response.status === 429) throw new MigoApiError(429, "TOO_MANY_REQUESTS", "Migo: se superó el límite de 10 tokens por hora de la credencial");
    if (!response.ok) throw await errorFrom(response, "POST /oauth2/token");
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) throw new MigoApiError(response.status, null, "Migo no devolvió access_token");
    const lifetimeMs = (Number(payload.expires_in) > 0 ? Number(payload.expires_in) : 3600) * 1000;
    this.token = { value: payload.access_token, expiresAt: this.now() + lifetimeMs };
    return payload.access_token;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "no respondió a tiempo" : error instanceof Error ? error.message : String(error);
      throw new MigoApiError(0, null, `No se pudo conectar con Migo: ${reason}`);
    }
  }
}

async function errorFrom(response: Response, operation: string): Promise<MigoApiError> {
  let body: MigoErrorBody | null = null;
  try {
    body = (await response.json()) as MigoErrorBody;
  } catch {
    body = null;
  }
  const code = body?.error ?? null;
  const parts = [body?.message ?? response.statusText ?? "error"];
  if (body?.errors?.length) parts.push(body.errors.map((error) => `${error.field}: ${error.message}`).join("; "));
  if (body?.details !== undefined && body.details !== null) parts.push(JSON.stringify(body.details).slice(0, 300));
  return new MigoApiError(response.status, code, `Migo ${response.status}${code ? ` ${code}` : ""} en ${operation}: ${parts.join(" · ")}`);
}
