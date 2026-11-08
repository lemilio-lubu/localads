import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { UnhandledErrorFilter } from "./common/errors/unhandled-error.filter";
import { RechargesModule } from "./modules/recharges/recharges.module";
import { DatabaseModule } from "./database/database.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { TeamModule } from "./modules/team/team.module";
import { PaymentAccountModule } from "./modules/payment-account/payment-account.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthController } from "./health.controller";
import { SecurityEventsModule } from "./modules/security-events/security-events.module";

@Module({ imports: [DatabaseModule, AuthModule, RechargesModule, ClientsModule, TeamModule, PaymentAccountModule, SecurityEventsModule], controllers: [HealthController], providers: [{ provide: APP_FILTER, useClass: UnhandledErrorFilter }] })
export class AppModule {}
