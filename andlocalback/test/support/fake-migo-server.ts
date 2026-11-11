import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import type {
  MigoCustomer,
  MigoCustomerRequest,
  MigoInvoiceRequest,
  MigoInvoiceResponse,
  MigoInvoiceStatus,
  MigoLookup,
} from "../../src/modules/recharges/infrastructure/services/migo/migo-api.types";

/**
 * Emulador de la API de Migo para las pruebas de integración, escrito a
 * partir de su contrato (apidocs.migo.com.ec): OAuth2 client_credentials,
 * clientes y facturas, con las validaciones que documenta (campos
 * obligatorios, IVA recalculado línea a línea → 422 TOTALS_MISMATCH).
 *
 * Supuestos que hay que confirmar con Migo (marcados en el plan):
 * - invoiceUuid deduplica: el mismo UUID devuelve la factura existente.
 * - el IVA de la línea se redondea a centavos, mitad hacia arriba.
 *
 * Las facturas nacen en SENT_TO_SRI; el test decide cuándo el «SRI»
 * responde con authorizeAll / reject.
 */
export type FakeMigo = Readonly<{
  url: string;
  credentials: Readonly<{ clientId: string; clientSecret: string }>;
  state: {
    tokensIssued: number;
    invoicePosts: number;
    customers: MigoCustomer[];
    /* Plazos de pago de la empresa; el test puede crear más. */
    paymentTerms: MigoLookup[];
    invoices: (MigoInvoiceResponse & { request: MigoInvoiceRequest })[];
    /* Fecha de hoy para Migo (aaaa-mm-dd): con ella rechaza fechas de emisión
       anteriores, como la Migo real. Sin ella no comprueba la fecha. */
    today: string | null;
    /* Peticiones que fallan a propósito: «caído» responde 503 a todo. */
    down: boolean;
  };
  authorizeAll(): void;
  reject(id: number, sriMessage: string): void;
  revokeTokens(): void;
  close(): Promise<void>;
}>;

export const FAKE_MIGO_VAT_TAX_ID = 4;
export const FAKE_MIGO_EMISSION_POINT_ID = 239;
/* Los productos «Servicio de Intermediación por Pauta …» de AND en Migo. */
export const FAKE_MIGO_PRODUCTS = { META: 6644066, GOOGLE: 6644062, TIKTOK: 6644068 } as const;
/* Transferencia Bancaria y Cliente (Crédito), con los ids de AND. */
export const FAKE_MIGO_PAYMENT_METHODS = { TRANSFER: 6, CREDIT: 8 } as const;
/* Los plazos que tiene AND en Migo. */
export const FAKE_MIGO_PAYMENT_TERMS: readonly MigoLookup[] = [
  { id: 21299, code: null, name: "2 DIAS" },
  { id: 21297, code: null, name: "Crédito 30 días" },
];

export async function startFakeMigo(): Promise<FakeMigo> {
  const credentials = { clientId: "localads-test", clientSecret: "secreto-de-prueba" };
  const validTokens = new Set<string>();
  let sequence = 0;
  const state: FakeMigo["state"] = { tokensIssued: 0, invoicePosts: 0, customers: [], paymentTerms: [...FAKE_MIGO_PAYMENT_TERMS], invoices: [], today: null, down: false };

  const server: Server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => send(response, 500, { status: 500, error: "INTERNAL_SERVER_ERROR", message: String(error) }));
  });

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://localhost");
    const body = await read(request);
    if (state.down) return send(response, 503, { status: 503, error: "SERVICE_UNAVAILABLE", message: "Migo en mantenimiento" });

    if (request.method === "POST" && url.pathname === "/oauth2/token") {
      const expected = `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`;
      if (request.headers.authorization !== expected) return send(response, 401, { error: "invalid_client", message: "Credenciales inválidas" });
      if (new URLSearchParams(body).get("grant_type") !== "client_credentials") return send(response, 400, { error: "unsupported_grant_type" });
      if (state.tokensIssued >= 10) return send(response, 429, { error: "TOO_MANY_REQUESTS" });
      const token = `tok-${++state.tokensIssued}`;
      validTokens.add(token);
      return send(response, 200, { access_token: token, token_type: "Bearer", expires_in: 3599 });
    }

    const token = request.headers.authorization?.replace(/^Bearer /, "");
    if (!token || !validTokens.has(token)) return send(response, 401, { status: 401, error: "UNAUTHORIZED", message: "Token ausente o inválido", path: url.pathname });

    if (request.method === "GET" && url.pathname === "/api/v1/customers") {
      const search = url.searchParams.get("search") ?? "";
      const size = Number(url.searchParams.get("size") ?? 20);
      if (size > 50) return send(response, 400, { status: 400, error: "BAD_REQUEST", message: "size máximo 50" });
      const includeInactive = url.searchParams.get("includeInactive") === "true";
      const data = state.customers.filter((customer) => (includeInactive || customer.active)
        && (customer.identificationNumber.includes(search) || customer.socialReason.toLowerCase().includes(search.toLowerCase())));
      return send(response, 200, { data, pagination: { page: 0, size, totalElements: data.length, totalPages: 1 } });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/customers") {
      const customer = JSON.parse(body) as MigoCustomerRequest;
      const errors = [
        !customer.identificationTypeId && { field: "identificationTypeId", message: "no debe ser nulo" },
        !customer.customerGroupId && { field: "customerGroupId", message: "no debe ser nulo" },
        (customer.socialReason?.length ?? 0) > 80 && { field: "socialReason", message: "el tamaño debe estar entre 0 y 80" },
        /* Como la Migo real (visto en producción el 2026-11-09). */
        !customer.address?.trim() && { field: "address", message: "No puede estar en blanco" },
        !customer.phone?.trim() && { field: "phone", message: "No puede estar en blanco" },
      ].filter(Boolean);
      if (errors.length) return send(response, 400, { status: 400, error: "BAD_REQUEST", message: `Validación fallida en ${errors.length} campo(s)`, errors });
      if (state.customers.some((existing) => existing.identificationNumber === customer.identificationNumber)) {
        return send(response, 422, { status: 422, error: "UNPROCESSABLE_ENTITY", message: "Se encontraron errores de validación de negocio", details: ["Ya existe un cliente con esa identificación"] });
      }
      const created: MigoCustomer = { id: 1000 + state.customers.length, identificationNumber: customer.identificationNumber, socialReason: customer.socialReason, email: customer.email ?? null, active: true };
      state.customers.push(created);
      return send(response, 201, created);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/payment-terms/options") return send(response, 200, state.paymentTerms);

    if (request.method === "POST" && url.pathname === "/api/v1/invoices") {
      state.invoicePosts++;
      const invoice = JSON.parse(body) as MigoInvoiceRequest;
      const duplicate = state.invoices.find((existing) => existing.request.invoiceUuid === invoice.invoiceUuid);
      if (duplicate) return send(response, 201, presenter(duplicate));
      const problem = validateInvoice(invoice, state.customers, state.paymentTerms, state.today);
      if (problem) return send(response, problem.status, problem.body);
      sequence++;
      const stored = { id: 4500 + sequence, number: `001-001-${String(sequence).padStart(9, "0")}`, status: "SENT_TO_SRI" as MigoInvoiceStatus, issueDate: invoice.issueDate, request: invoice };
      state.invoices.push(stored);
      return send(response, 201, presenter(stored));
    }

    const match = /^\/api\/v1\/invoices\/(\d+)$/.exec(url.pathname);
    if (request.method === "GET" && match) {
      const found = state.invoices.find((invoice) => invoice.id === Number(match[1]));
      if (!found) return send(response, 404, { status: 404, error: "NOT_FOUND", message: "La factura no existe" });
      return send(response, 200, presenter(found));
    }

    return send(response, 404, { status: 404, error: "NOT_FOUND", message: `${request.method} ${url.pathname}` });
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://localhost:${port}`,
    credentials,
    state,
    authorizeAll() {
      for (const invoice of state.invoices) {
        if (invoice.status !== "SENT_TO_SRI") continue;
        invoice.status = "AUTHORIZED";
        invoice.accessKey = accessKeyFor(invoice.id);
        invoice.authorizationKey = invoice.accessKey;
        invoice.sriStatus = "AUTORIZADO";
      }
    },
    reject(id, sriMessage) {
      const invoice = state.invoices.find((candidate) => candidate.id === id);
      if (!invoice) throw new Error(`no existe la factura ${id}`);
      Object.assign(invoice, { status: "NOT_AUTHORIZED", sriStatus: "NO AUTORIZADO", sriMessage });
    },
    revokeTokens() {
      validTokens.clear();
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

/* Las reglas que documenta Migo para emitir. */
function validateInvoice(invoice: MigoInvoiceRequest, customers: MigoCustomer[], paymentTerms: MigoLookup[], today: string | null) {
  const required = ["documentType", "invoiceUuid", "emissionPointId", "subtotalAmount", "taxAmount", "totalAmount", "tipAmount", "customer"] as const;
  const errors: { field: string; message: string }[] = required
    .filter((field) => invoice[field] === undefined || invoice[field] === null)
    .map((field) => ({ field, message: "no debe ser nulo" }));
  if (!invoice.details?.length) errors.push({ field: "details", message: "debe tener al menos 1 elemento" });
  if (!/^[0-9a-f-]{36}$/.test(invoice.invoiceUuid ?? "")) errors.push({ field: "invoiceUuid", message: "debe ser un UUID" });
  if (errors.length) return { status: 400, body: { status: 400, error: "BAD_REQUEST", message: `Validación fallida en ${errors.length} campo(s)`, errors } };

  const business: string[] = [];
  if (invoice.emissionPointId !== FAKE_MIGO_EMISSION_POINT_ID) business.push("Punto de emisión inexistente");
  if (!customers.some((customer) => customer.id === invoice.customer.id)) business.push("El cliente no existe");
  invoice.details.forEach((line, index) => {
    if (!(Object.values(FAKE_MIGO_PRODUCTS) as number[]).includes(line.product?.id)) business.push(`Línea ${index + 1}: producto inexistente`);
    if (line.tax?.id !== FAKE_MIGO_VAT_TAX_ID) business.push(`Línea ${index + 1}: el impuesto no coincide con el del producto`);
  });
  /* Como la Migo real (visto en producción el 2026-11-10). */
  if (today && invoice.issueDate < today) {
    const ddmmyyyy = (value: string) => value.split("-").reverse().join("/");
    business.push(`La fecha de emisión ${ddmmyyyy(invoice.issueDate)} no es válida. Debe ser igual o posterior al ${ddmmyyyy(today)}.`);
  }
  /* Como la Migo real (visto en producción el 2026-11-09): las formas de pago
     se exigen y la de crédito no va sin plazo. */
  const paid = (invoice.payments ?? []).reduce((total, payment) => total + Math.round(payment.amount * 100), 0);
  if (paid < Math.round(invoice.totalAmount * 100)) business.push("El valor total en formas de pago no puede ser inferior al valor total de la factura.");
  for (const payment of invoice.payments ?? []) {
    if (!(Object.values(FAKE_MIGO_PAYMENT_METHODS) as number[]).includes(payment.paymentMethod?.id)) business.push("Forma de pago inexistente");
    if (payment.paymentMethod?.id === FAKE_MIGO_PAYMENT_METHODS.CREDIT && !payment.paymentTerm) business.push("Debe seleccionar el término de pago para la forma de pago Cliente Crédito.");
    if (payment.paymentTerm && !paymentTerms.some((term) => term.id === payment.paymentTerm!.id)) business.push("Plazo de pago inexistente");
  }
  if (business.length) return { status: 422, body: { status: 422, error: "UNPROCESSABLE_ENTITY", message: "Se encontraron errores de validación de negocio", details: business } };

  const cents = (value: number) => Math.round(value * 100);
  const mismatches: unknown[] = [];
  let subtotal = 0;
  let tax = 0;
  invoice.details.forEach((line, index) => {
    const lineSubtotal = cents(line.quantity * line.priceUnit) - cents(line.discountAmount);
    const lineTax = Math.floor((lineSubtotal * 15 + 50) / 100);
    if (lineSubtotal !== cents(line.subtotalAmount)) mismatches.push({ field: "subtotalAmount", lineNumber: index + 1, expected: lineSubtotal / 100, actual: line.subtotalAmount });
    if (lineTax !== cents(line.taxAmount)) mismatches.push({ field: "taxAmount", lineNumber: index + 1, expected: lineTax / 100, actual: line.taxAmount });
    if (lineSubtotal + lineTax !== cents(line.totalAmount)) mismatches.push({ field: "totalAmount", lineNumber: index + 1, expected: (lineSubtotal + lineTax) / 100, actual: line.totalAmount });
    subtotal += lineSubtotal;
    tax += lineTax;
  });
  if (subtotal !== cents(invoice.subtotalAmount)) mismatches.push({ field: "subtotalAmount", expected: subtotal / 100, actual: invoice.subtotalAmount });
  if (tax !== cents(invoice.taxAmount)) mismatches.push({ field: "taxAmount", expected: tax / 100, actual: invoice.taxAmount });
  if (subtotal + tax !== cents(invoice.totalAmount)) mismatches.push({ field: "totalAmount", expected: (subtotal + tax) / 100, actual: invoice.totalAmount });
  if (mismatches.length) {
    return { status: 422, body: { status: 422, error: "TOTALS_MISMATCH", message: "Los totales calculados no coinciden con los enviados", details: mismatches } };
  }
  return null;
}

function presenter(invoice: MigoInvoiceResponse): MigoInvoiceResponse {
  const { id, number, status, accessKey, authorizationKey, issueDate, sriStatus, sriMessage } = invoice;
  return { id, number, status, accessKey: accessKey ?? null, authorizationKey: authorizationKey ?? null, issueDate, sriStatus: sriStatus ?? null, sriMessage: sriMessage ?? null, messages: [] };
}

const accessKeyFor = (id: number) => `071120260117900123450012001001${String(id).padStart(9, "0")}1234567811`.slice(0, 49);

function read(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
