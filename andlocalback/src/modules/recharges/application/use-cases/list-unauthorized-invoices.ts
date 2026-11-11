import { InvoiceAuthorizationPersistencePort, UnauthorizedInvoice } from "../ports/invoice-issuer.ports";

const LIMIT = 100;

/* FAILING: el último intento falló y hay un motivo que mirar.
   WAITING_SRI: el proveedor la tiene y falta la respuesta del SRI.
   QUEUED: recién creada, la toma el siguiente ciclo. */
export type UnauthorizedInvoiceState = "FAILING" | "WAITING_SRI" | "QUEUED";

export type UnauthorizedInvoiceView = Readonly<Omit<UnauthorizedInvoice, "createdAt" | "nextAttemptAt" | "externalReference"> & {
  state: UnauthorizedInvoiceState;
  createdAt: string;
  nextAttemptAt: string | null;
  /* Horas enteras que lleva sin autorizar. */
  pendingHours: number;
}>;

/** Las facturas que siguen sin autorizar, con su motivo, para el admin. */
export class ListUnauthorizedInvoices {
  constructor(
    private readonly persistence: InvoiceAuthorizationPersistencePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<readonly UnauthorizedInvoiceView[]> {
    const now = this.now().getTime();
    return (await this.persistence.listUnauthorized(LIMIT)).map(({ externalReference, createdAt, nextAttemptAt, ...invoice }) => ({
      ...invoice,
      state: invoice.reason ? "FAILING" : externalReference ? "WAITING_SRI" : "QUEUED",
      createdAt: createdAt.toISOString(),
      nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
      pendingHours: Math.max(0, Math.floor((now - createdAt.getTime()) / 3_600_000)),
    }));
  }
}
