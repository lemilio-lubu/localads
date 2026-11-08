import { createHash } from "node:crypto";
import { InvoiceAuthorizationRequest } from "../../../application/ports/invoice-issuer.ports";
import { AndPricingPolicy } from "../../../domain/policies/and-pricing.policy";
import { MonetaryAmount } from "../../../domain/value-objects/monetary-amount";
import { MigoInvoiceRequest, MigoPaymentRequest } from "./migo-api.types";

/* Ids del catálogo de la empresa en Migo. Se consultan una vez
   (/emission-points/options, /products, /taxes/options…) y se configuran. */
export type MigoProduct = Readonly<{ id: number; code: string | null }>;

export type MigoInvoiceSettings = Readonly<{
  emissionPointId: number;
  /* Un producto de servicio por plataforma (META, GOOGLE, TIKTOK), como
     factura AND en Migo: «Servicio de Intermediación por Pauta Meta»… */
  products: Readonly<Record<string, MigoProduct>>;
  vatTaxId: number;
  vendorId: number | null;
  activityId: number | null;
  /* Sin formas de pago configuradas no se envían: Migo no las exige. */
  payments: Readonly<{ prepaidMethodId: number; creditMethodId: number; creditTermId: number | null }> | null;
}>;

/* Espacio de nombres propio de localads para el UUID v5 de cada factura. */
const INVOICE_UUID_NAMESPACE = "8d0f3c3e-5b8a-4f4e-9b1e-6c2a1d7e9f40";
const VAT_RATE_PERCENT = AndPricingPolicy.VAT_RATE_BASIS_POINTS / 100;
const PLATFORM_LABELS: Readonly<Record<string, string>> = { META: "Meta", GOOGLE: "Google", TIKTOK: "TikTok" };
export const MIGO_SOCIAL_REASON_MAX = 80;

export class MigoMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigoMappingError";
  }
}

/** UUID v5 (RFC 4122): el mismo nombre da siempre el mismo UUID. */
export function uuidV5(name: string, namespace: string): string {
  const hash = createHash("sha1").update(Buffer.from(namespace.replace(/-/g, ""), "hex")).update(name, "utf8").digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* Clave de idempotencia ante Migo: derivada del número interno, así un
   reintento manda el mismo invoiceUuid y no una factura nueva. */
export const migoInvoiceUuid = (invoiceNumber: string) => uuidV5(invoiceNumber, INVOICE_UUID_NAMESPACE);

export const migoSocialReason = (name: string) => name.trim().slice(0, MIGO_SOCIAL_REASON_MAX).trim();

/* Fecha de emisión en Ecuador: en UTC, una recarga de las 19:00 saldría con el día siguiente. */
export const ecuadorDate = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(value);

const amount = (value: MonetaryAmount) => value.toSafeNumber();
const sum = (values: readonly MonetaryAmount[]) => values.reduce((total, value) => total.add(value), MonetaryAmount.zero());

/**
 * Traduce una factura de localads a la de Migo: una línea por plataforma con
 * la base completa (pauta + ISD + comisión) y su IVA. Así el IVA que Migo
 * recalcula línea a línea es el mismo que AndPricingPolicy ya cobró.
 *
 * Antes de enviar nada comprueba que líneas y totales cuadran al centavo:
 * un descuadre aquí sería un TOTALS_MISMATCH en Migo, o peor, una factura
 * distinta de lo cobrado.
 */
export function buildMigoInvoice(
  request: InvoiceAuthorizationRequest,
  customerId: number,
  settings: MigoInvoiceSettings,
): MigoInvoiceRequest {
  if (!request.customer.ruc) throw new MigoMappingError(`La factura ${request.invoiceNumber} no tiene RUC del cliente`);
  if (request.lines.length === 0) throw new MigoMappingError(`La factura ${request.invoiceNumber} no tiene líneas`);

  for (const [index, line] of request.lines.entries()) {
    if (!settings.products[line.platform]) {
      throw new MigoMappingError(`Línea ${index + 1}: no hay producto de Migo configurado para la plataforma ${line.platform}`);
    }
    const expectedVat = line.vatBaseAmount.multiplyRatio(AndPricingPolicy.VAT_RATE_BASIS_POINTS, 10_000);
    if (!line.vatAmount.equals(expectedVat)) {
      throw new MigoMappingError(`Línea ${index + 1}: el IVA ${line.vatAmount.toMajorUnits()} no es el ${VAT_RATE_PERCENT}% de ${line.vatBaseAmount.toMajorUnits()}`);
    }
    if (!line.vatBaseAmount.add(line.vatAmount).equals(line.totalAmount)) {
      throw new MigoMappingError(`Línea ${index + 1}: base más IVA no da el total`);
    }
  }
  const { totals } = request;
  const checks: [string, MonetaryAmount, MonetaryAmount][] = [
    ["base imponible", sum(request.lines.map((line) => line.vatBaseAmount)), totals.vatBaseAmount],
    ["IVA", sum(request.lines.map((line) => line.vatAmount)), totals.vatAmount],
    ["total", sum(request.lines.map((line) => line.totalAmount)), totals.totalAmount],
    ["pauta", sum(request.lines.map((line) => line.amount)), totals.pautaAmount],
  ];
  for (const [label, fromLines, total] of checks) {
    if (!fromLines.equals(total)) {
      throw new MigoMappingError(`Descuadre en ${label}: las líneas suman ${fromLines.toMajorUnits()} y la factura dice ${total.toMajorUnits()}`);
    }
  }

  return {
    documentType: "INVOICE",
    invoiceUuid: migoInvoiceUuid(request.invoiceNumber),
    issueDate: ecuadorDate(request.issuedAt),
    emissionPointId: settings.emissionPointId,
    ...(settings.vendorId !== null ? { vendorId: settings.vendorId } : {}),
    ...(settings.activityId !== null ? { activityId: settings.activityId } : {}),
    subtotalAmount: amount(totals.vatBaseAmount),
    taxAmount: amount(totals.vatAmount),
    totalAmount: amount(totals.totalAmount),
    tipAmount: 0,
    observation: `Recarga ${request.transactionCode} · ${request.invoiceNumber}`,
    customer: { id: customerId, identificationNumber: request.customer.ruc, socialReason: migoSocialReason(request.customer.name) },
    details: request.lines.map((line) => {
      const product = settings.products[line.platform];
      return {
        product: { id: product.id },
        ...(product.code ? { referenceCode: product.code } : {}),
        // El mismo texto que ya usa AND en sus facturas de Migo.
        description: `Servicio de Intermediación por Pauta ${PLATFORM_LABELS[line.platform] ?? line.platform}`,
        quantity: 1,
        priceUnit: amount(line.vatBaseAmount),
        discountAmount: 0,
        subtotalAmount: amount(line.vatBaseAmount),
        taxAmount: amount(line.vatAmount),
        iceAmount: 0,
        totalAmount: amount(line.totalAmount),
        tax: { id: settings.vatTaxId, rate: VAT_RATE_PERCENT },
      };
    }),
    ...(settings.payments ? { payments: [payment(request, settings.payments)] } : {}),
    additionalInfo: [
      { label: "Transacción", value: request.transactionCode },
      { label: "Pauta", value: `US$ ${totals.pautaAmount.toMajorUnits()}` },
      { label: "ISD", value: `US$ ${totals.isdAmount.toMajorUnits()}` },
      { label: "Comisión de agencia", value: `US$ ${totals.agencyFeeAmount.toMajorUnits()}` },
    ],
  };
}

function payment(request: InvoiceAuthorizationRequest, methods: NonNullable<MigoInvoiceSettings["payments"]>): MigoPaymentRequest {
  const total = amount(request.totals.totalAmount);
  if (request.payment.mode === "PREPAID") return { amount: total, paymentMethod: { id: methods.prepaidMethodId } };
  return {
    amount: total,
    paymentMethod: { id: methods.creditMethodId },
    ...(methods.creditTermId !== null ? { paymentTerm: { id: methods.creditTermId } } : {}),
  };
}
