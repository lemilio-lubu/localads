import { Module } from "@nestjs/common";
import { SECURITY_EVENTS_QUERY, SecurityEventsQuery } from "./application/ports/security-events.query";
import { ListSecurityEvents } from "./application/use-cases/list-security-events";
import { PrismaSecurityEventsQuery } from "./infrastructure/prisma-security-events.query";
import { SecurityEventsController } from "./presentation/security-events.controller";

@Module({
  controllers: [SecurityEventsController],
  providers: [
    PrismaSecurityEventsQuery,
    { provide: SECURITY_EVENTS_QUERY, useExisting: PrismaSecurityEventsQuery },
    { provide: ListSecurityEvents, inject: [SECURITY_EVENTS_QUERY], useFactory: (events: SecurityEventsQuery) => new ListSecurityEvents(events) },
  ],
})
export class SecurityEventsModule {}
