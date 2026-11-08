import { describe, expect, it, vi } from "vitest";
import { MigoApiClient, MigoApiError } from "./migo-api.client";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
type Reply = { status: number; body?: unknown } | Error;

/* fetch falso: responde en orden a cada ruta y registra lo que se pidió. */
function fakeFetch(routes: Record<string, Reply[]>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined });
    const key = `${method} ${new URL(url).pathname}`;
    const reply = routes[key]?.shift();
    if (!reply) throw new Error(`ruta no esperada: ${key}`);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const config = { baseUrl: "https://api.migo.test/", clientId: "cliente-id", clientSecret: "secreto-super", timeoutMs: 1000 };
const token = (value = "tok-1", expires = 3599) => ({ status: 200, body: { access_token: value, token_type: "Bearer", expires_in: expires } });
const invoice = { id: 4521, number: "001-001-000000123", status: "SENT_TO_SRI" };

describe("cliente de la API de Migo", () => {
  it("pide el token con client_credentials por Basic Auth y lo usa como Bearer", async () => {
    const { impl, calls } = fakeFetch({ "POST /oauth2/token": [token()], "GET /api/v1/invoices/4521": [{ status: 200, body: invoice }] });
    const result = await new MigoApiClient(config, impl).getInvoice("4521");
    expect(result).toEqual(invoice);
    expect(calls[0]).toMatchObject({
      url: "https://api.migo.test/oauth2/token",
      method: "POST",
      body: "grant_type=client_credentials",
      headers: { Authorization: `Basic ${Buffer.from("cliente-id:secreto-super").toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(calls[1]).toMatchObject({ url: "https://api.migo.test/api/v1/invoices/4521", headers: { Authorization: "Bearer tok-1" } });
  });

  it("reutiliza el token mientras vive y pide uno solo aunque lleguen peticiones a la vez (máx. 10 por hora)", async () => {
    const { impl, calls } = fakeFetch({ "POST /oauth2/token": [token()], "GET /api/v1/invoices/1": [{ status: 200, body: invoice }, { status: 200, body: invoice }, { status: 200, body: invoice }] });
    const client = new MigoApiClient(config, impl);
    await Promise.all([client.getInvoice("1"), client.getInvoice("1")]);
    await client.getInvoice("1");
    expect(calls.filter((call) => call.url.endsWith("/oauth2/token"))).toHaveLength(1);
  });

  it("renueva el token un minuto antes de que venza", async () => {
    let now = 0;
    const { impl, calls } = fakeFetch({ "POST /oauth2/token": [token("tok-1"), token("tok-2")], "GET /api/v1/invoices/1": [{ status: 200, body: invoice }, { status: 200, body: invoice }, { status: 200, body: invoice }] });
    const client = new MigoApiClient(config, impl, () => now);
    await client.getInvoice("1");
    now = 3599_000 - 61_000;
    await client.getInvoice("1");
    now = 3599_000 - 59_000;
    await client.getInvoice("1");
    expect(calls.filter((call) => call.url.includes("/invoices/")).map((call) => call.headers.Authorization)).toEqual(["Bearer tok-1", "Bearer tok-1", "Bearer tok-2"]);
  });

  it("ante un 401 pide un token nuevo y reintenta una sola vez", async () => {
    const { impl, calls } = fakeFetch({
      "POST /oauth2/token": [token("tok-1"), token("tok-2"), token("tok-3")],
      "GET /api/v1/invoices/1": [{ status: 401, body: { error: "UNAUTHORIZED" } }, { status: 200, body: invoice }, { status: 401 }, { status: 401, body: { status: 401, error: "UNAUTHORIZED", message: "Token ausente o inválido" } }],
    });
    const client = new MigoApiClient(config, impl);
    expect(await client.getInvoice("1")).toEqual(invoice);
    await expect(client.getInvoice("1")).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(calls.filter((call) => call.url.endsWith("/oauth2/token"))).toHaveLength(3);
  });

  it("traduce el error de Migo con su código, campos y detalle, sin filtrar credenciales", async () => {
    const { impl } = fakeFetch({
      "POST /oauth2/token": [token()],
      "POST /api/v1/invoices": [
        { status: 422, body: { status: 422, error: "TOTALS_MISMATCH", message: "Los totales calculados no coinciden con los enviados", details: [{ field: "subtotalAmount", expected: 17, actual: 17.5, lineNumber: 1 }] } },
        { status: 400, body: { status: 400, error: "BAD_REQUEST", message: "Validación fallida en 1 campo(s)", errors: [{ field: "emissionPointId", message: "no debe ser nulo" }] } },
        { status: 500 },
      ],
    });
    const client = new MigoApiClient(config, impl);
    const mismatch = await client.createInvoice({} as never).catch((error: unknown) => error);
    expect(mismatch).toBeInstanceOf(MigoApiError);
    expect(mismatch).toMatchObject({ status: 422, code: "TOTALS_MISMATCH" });
    expect((mismatch as Error).message).toContain("Migo 422 TOTALS_MISMATCH en POST /api/v1/invoices: Los totales calculados no coinciden");
    expect((mismatch as Error).message).toContain('"expected":17');
    const invalid = (await client.createInvoice({} as never).catch((error: unknown) => error)) as Error;
    expect(invalid.message).toContain("emissionPointId: no debe ser nulo");
    const crashed = await client.createInvoice({} as never).catch((error: MigoApiError) => error);
    expect(crashed).toMatchObject({ status: 500, code: null });
    for (const error of [mismatch, invalid, crashed] as Error[]) {
      expect(error.message).not.toContain("secreto-super");
      expect(error.message).not.toContain("tok-1");
    }
  });

  it("el límite de tokens y las credenciales inválidas se reportan claro", async () => {
    const limited = fakeFetch({ "POST /oauth2/token": [{ status: 429 }] });
    await expect(new MigoApiClient(config, limited.impl).getInvoice("1")).rejects.toMatchObject({ status: 429, message: expect.stringContaining("10 tokens por hora") });
    const invalid = fakeFetch({ "POST /oauth2/token": [{ status: 401, body: { error: "invalid_client", message: "Credenciales inválidas" } }] });
    await expect(new MigoApiClient(config, invalid.impl).getInvoice("1")).rejects.toMatchObject({ status: 401, code: "invalid_client" });
    const empty = fakeFetch({ "POST /oauth2/token": [{ status: 200, body: {} }] });
    await expect(new MigoApiClient(config, empty.impl).getInvoice("1")).rejects.toThrow(/no devolvió access_token/);
  });

  it("sin conexión o sin respuesta a tiempo falla con status 0, y el siguiente intento vuelve a pedir token", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const { impl } = fakeFetch({ "POST /oauth2/token": [new Error("ECONNREFUSED"), token()], "GET /api/v1/invoices/1": [timeout] });
    const client = new MigoApiClient(config, impl);
    await expect(client.getInvoice("1")).rejects.toMatchObject({ status: 0, message: "No se pudo conectar con Migo: ECONNREFUSED" });
    await expect(client.getInvoice("1")).rejects.toMatchObject({ status: 0, message: "No se pudo conectar con Migo: no respondió a tiempo" });
  });

  it("busca el cliente por RUC exacto: la búsqueda de Migo también devuelve parciales", async () => {
    const page = (data: unknown[]) => ({ status: 200, body: { data, pagination: { page: 0, size: 50, totalElements: data.length, totalPages: 1 } } });
    const { impl, calls } = fakeFetch({
      "POST /oauth2/token": [token()],
      "GET /api/v1/customers": [
        page([{ id: 9, identificationNumber: "17900123450019", socialReason: "Otra", active: true }, { id: 7, identificationNumber: "1790012345001", socialReason: "Cliente", active: false }]),
        page([{ id: 9, identificationNumber: "17900123450019", socialReason: "Otra", active: true }]),
      ],
    });
    const client = new MigoApiClient(config, impl);
    expect(await client.findCustomerByIdentification("1790012345001")).toMatchObject({ id: 7 });
    expect(await client.findCustomerByIdentification("1790012345001")).toBeNull();
    const query = new URL(calls[1].url).searchParams;
    expect(Object.fromEntries(query)).toEqual({ search: "1790012345001", includeInactive: "true", page: "0", size: "50" });
  });

  it("crea cliente y factura enviando JSON", async () => {
    const { impl, calls } = fakeFetch({ "POST /oauth2/token": [token()], "POST /api/v1/customers": [{ status: 201, body: { id: 7 } }] });
    await new MigoApiClient(config, impl).createCustomer({ identificationNumber: "1790012345001", identificationTypeId: 4, customerGroupId: 1, socialReason: "Cliente" });
    expect(calls[1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(calls[1].body!)).toEqual({ identificationNumber: "1790012345001", identificationTypeId: 4, customerGroupId: 1, socialReason: "Cliente" });
  });
});
