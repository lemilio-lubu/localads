import { Module } from "@nestjs/common";
import { CLIENT_ADMIN_REPOSITORY, ClientAdminRepository } from "./application/ports/client-admin.repository";
import { CLIENT_CREDENTIALS_ISSUER, ClientCredentialsIssuer } from "./application/ports/client-credentials.port";
import { ManageClients } from "./application/use-cases/manage-clients";
import { PrismaClientAdminRepository } from "./infrastructure/prisma-client-admin.repository";
import { ClientsController } from "./presentation/clients.controller";
import { RechargesModule } from "../recharges/recharges.module";
import { AuthModule } from "../auth/auth.module";
import { CredentialsService } from "../auth/credentials.service";
import { AuditModule } from "../../common/audit/audit.module";
import { SECURITY_AUDIT_LOG, SecurityAuditLog } from "../../common/audit/security-audit.port";
import { CREDIT_TERMS_CATALOG, CreditTermsCatalog } from "./application/ports/credit-terms.port";
import { InvoiceIssuerCreditTerms } from "./infrastructure/invoice-issuer-credit-terms";
import { INVOICE_ISSUER, InvoiceIssuer } from "../recharges/application/ports/invoice-issuer.ports";

@Module({
  imports: [RechargesModule, AuthModule, AuditModule],
  controllers: [ClientsController],
  providers: [
    PrismaClientAdminRepository,
    { provide: CLIENT_ADMIN_REPOSITORY, useExisting: PrismaClientAdminRepository },
    { provide: CLIENT_CREDENTIALS_ISSUER, useExisting: CredentialsService },
    { provide: CREDIT_TERMS_CATALOG, inject: [INVOICE_ISSUER], useFactory: (issuer: InvoiceIssuer) => new InvoiceIssuerCreditTerms(issuer) },
    {
      provide: ManageClients,
      inject: [CLIENT_ADMIN_REPOSITORY, CLIENT_CREDENTIALS_ISSUER, SECURITY_AUDIT_LOG, CREDIT_TERMS_CATALOG],
      useFactory: (clients: ClientAdminRepository, credentials: ClientCredentialsIssuer, audit: SecurityAuditLog, creditTerms: CreditTermsCatalog) =>
        new ManageClients(clients, credentials, audit, creditTerms),
    },
  ],
})
export class ClientsModule {}
