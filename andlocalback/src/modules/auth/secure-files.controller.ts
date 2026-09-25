import { Controller, ForbiddenException, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { Response } from "express";
import { basename, join } from "node:path";
import { PrismaService } from "../../database/prisma.service";
import { CurrentUser } from "./auth.decorators";
import { AuthPrincipal } from "./auth.types";

type ReceiptOwner = Readonly<{ clientId: string; client: { managerId: string | null } }>;

/* Quién puede abrir un comprobante:
   - ADMIN, cualquiera.
   - GESTOR, solo los de clientes de su cartera. Fuera de ella responde 404,
     como el resto de recortes por cartera: un 403 confirmaría que existe y
     de quién es. Antes el gestor recibía 403 siempre, porque esta regla es
     anterior a su rol y solo miraba clientId, que un gestor no tiene: veía la
     verificación de su cliente pero no podía abrir la evidencia.
   - CLIENT, solo los suyos (403 si no). */
function assertCanRead(user: AuthPrincipal, owner: ReceiptOwner) {
  if (user.role === "ADMIN") return;
  if (user.role === "GESTOR") {
    if (owner.client.managerId !== user.userId) throw new NotFoundException("Comprobante no encontrado");
    return;
  }
  if (user.clientId !== owner.clientId) throw new ForbiddenException("No puedes consultar este comprobante");
}

const ownerSelect = { payment: { select: { transaction: { select: { clientId: true, client: { select: { managerId: true } } } } } } } as const;

@Controller("files")
export class SecureFilesController {
  constructor(private readonly database: PrismaService) {}

  @Get("receipts/:receiptId/content")
  async receiptContent(@Param("receiptId") receiptId: string, @CurrentUser() user: AuthPrincipal, @Res() response: Response) {
    const receipt = await this.database.paymentReceipt.findUnique({
      where: { id: receiptId },
      select: {
        originalName: true,
        mimeType: true,
        url: true,
        ...ownerSelect,
      },
    });
    if (!receipt) throw new NotFoundException("Comprobante no encontrado");
    assertCanRead(user, receipt.payment.transaction);
    return this.sendReceipt(response, receipt.url, receipt.originalName, receipt.mimeType);
  }

  @Get("receipts/:filename")
  async receipt(@Param("filename") filename: string, @CurrentUser() user: AuthPrincipal, @Res() response: Response) {
    if (!/^[A-Za-z0-9._-]+$/.test(filename)) throw new NotFoundException();
    const url = `/uploads/receipts/${filename}`;
    const receipt = await this.database.paymentReceipt.findFirst({ where: { url }, select: ownerSelect });
    if (!receipt) throw new NotFoundException("Comprobante no encontrado");
    assertCanRead(user, receipt.payment.transaction);
    return this.sendReceipt(response, url, filename, undefined);
  }

  private sendReceipt(response: Response, storedUrl: string, originalName: string, storedMimeType: string | undefined) {
    const filename = basename(storedUrl);
    if (!/^[A-Za-z0-9._-]+$/.test(filename) || !storedUrl.startsWith("/uploads/receipts/")) throw new NotFoundException();
    const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    if (storedMimeType && !allowedMimeTypes.has(storedMimeType)) throw new NotFoundException("Formato de comprobante no permitido");
    if (storedMimeType) response.type(storedMimeType);
    response.set({
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store, max-age=0",
    });
    return response.sendFile(filename, { root: join(process.cwd(), "uploads", "receipts") });
  }
}
