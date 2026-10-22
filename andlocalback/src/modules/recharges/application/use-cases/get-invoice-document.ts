import { ApplicationError } from "../../../../common/errors/application.error";
import { InvoiceAuthorizationPersistencePort, InvoiceIssuer } from "../ports/invoice-issuer.ports";

export type InvoiceViewer = Readonly<{ userId: string; role: "ADMIN" | "GESTOR" | "CLIENT"; clientId: string | null }>;
export type GetInvoiceDocumentCommand = Readonly<{ invoiceId: string; viewer: InvoiceViewer }>;
export type InvoiceDocumentFile = Readonly<{ content: Uint8Array; mimeType: "application/pdf"; filename: string }>;

/**
 * El PDF de una factura autorizada, pedido al emisor en cada consulta: así no
 * se guarda una copia que pudiera diferir de la del proveedor.
 *
 * Quién la abre: un admin, el gestor del cliente y el propio cliente. A
 * cualquier otro se le responde 404, como al resto de lo ajeno: un 403
 * confirmaría que la factura existe y de quién es.
 */
export class GetInvoiceDocument {
  constructor(
    private readonly persistence: InvoiceAuthorizationPersistencePort,
    private readonly issuer: InvoiceIssuer,
  ) {}

  async execute(command: GetInvoiceDocumentCommand): Promise<InvoiceDocumentFile> {
    const notFound = new ApplicationError("INVOICE_NOT_FOUND", "La factura no existe", 404);
    const source = await this.persistence.loadDocumentSource(command.invoiceId);
    if (!source) throw notFound;
    const { viewer } = command;
    const allowed = viewer.role === "ADMIN"
      || (viewer.role === "GESTOR" && source.owner.managerId === viewer.userId)
      || (viewer.role === "CLIENT" && viewer.clientId === source.owner.clientId);
    if (!allowed) throw notFound;
    if (!source.authorization) {
      throw new ApplicationError("INVOICE_NOT_AUTHORIZED", "La factura todavía no está autorizada", 409);
    }
    const document = await this.issuer.document(source.request, source.authorization);
    return { ...document, filename: `${source.request.invoiceNumber}.pdf` };
  }
}
