import { Controller, ForbiddenException, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { Response } from "express";
import { basename, join } from "node:path";
import { PrismaService } from "../../database/prisma.service";
import { CurrentUser } from "./auth.decorators";
import { AuthPrincipal } from "./auth.types";

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
        payment: { select: { transaction: { select: { clientId: true } } } },
      },
    });
    if (!receipt) throw new NotFoundException("Comprobante no encontrado");
    if (user.role !== "ADMIN" && user.clientId !== receipt.payment.transaction.clientId) {
      throw new ForbiddenException("No puedes consultar este comprobante");
    }
    return this.sendReceipt(response, receipt.url, receipt.originalName, receipt.mimeType);
  }

  @Get("receipts/:filename")
  async receipt(@Param("filename") filename: string, @CurrentUser() user: AuthPrincipal, @Res() response: Response) {
    if (!/^[A-Za-z0-9._-]+$/.test(filename)) throw new NotFoundException();
    const url = `/uploads/receipts/${filename}`;
    const receipt = await this.database.paymentReceipt.findFirst({ where: { url }, select: { payment: { select: { transaction: { select: { clientId: true } } } } } });
    const legacy = receipt ? null : await this.database.receipt.findFirst({ where: { url }, select: { recharge: { select: { account: { select: { clientId: true } } } } } });
    const ownerId = receipt?.payment.transaction.clientId ?? legacy?.recharge.account.clientId;
    if (!ownerId) throw new NotFoundException("Comprobante no encontrado");
    if (user.role !== "ADMIN" && user.clientId !== ownerId) throw new ForbiddenException("No puedes consultar este comprobante");
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
