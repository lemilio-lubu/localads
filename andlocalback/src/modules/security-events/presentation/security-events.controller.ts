import { Controller, Get, Query, UseFilters } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Roles } from "../../auth/auth.decorators";
import { ApplicationErrorFilter } from "../../recharges/presentation/application-error.filter";
import { SECURITY_EVENT_CATEGORIES, SecurityEventCategory } from "../application/ports/security-events.query";
import { ListSecurityEvents } from "../application/use-cases/list-security-events";

export class ListSecurityEventsQueryDto {
  @IsOptional() @IsIn([...SECURITY_EVENT_CATEGORIES]) category?: SecurityEventCategory;
  @IsOptional() @IsIn(["problems"]) outcome?: "problems";
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) page?: number;
}

/* El registro de seguridad de toda la plataforma: solo el admin. Un gestor
   veria accesos de clientes que no son de su cartera. */
@Controller("admin/security-events")
@Roles("ADMIN")
@UseFilters(ApplicationErrorFilter)
export class SecurityEventsController {
  constructor(private readonly events: ListSecurityEvents) {}

  @Get() list(@Query() query: ListSecurityEventsQueryDto) {
    return this.events.execute({ category: query.category, problemsOnly: query.outcome === "problems", search: query.search, page: query.page });
  }
}
