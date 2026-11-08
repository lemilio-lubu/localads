import { Module } from "@nestjs/common";
import { PrismaSecurityAuditLog } from "./prisma-security-audit.log";
import { SECURITY_AUDIT_LOG } from "./security-audit.port";

@Module({
  providers: [PrismaSecurityAuditLog, { provide: SECURITY_AUDIT_LOG, useExisting: PrismaSecurityAuditLog }],
  exports: [SECURITY_AUDIT_LOG],
})
export class AuditModule {}
