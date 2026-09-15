import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseFilters } from "@nestjs/common";
import { ApplicationErrorFilter } from "../../recharges/presentation/application-error.filter";
import { ManageClients } from "../application/use-cases/manage-clients";
import { CreateClientDto, UpdateClientDto } from "./dto/client.dto";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { TransactionsGateway } from "../../recharges/presentation/transactions.gateway";

@Controller("admin/clients")
@Roles("ADMIN")
@UseFilters(ApplicationErrorFilter)
export class ClientsController {
  constructor(private readonly clients: ManageClients, private readonly realtime: TransactionsGateway) {}

  @Get() list() { return this.clients.list(); }
  @Get(":id") get(@Param("id") id: string) { return this.clients.get(id); }
  @Post() create(@Body() body: CreateClientDto) { return this.clients.create(body); }
  @Patch(":id") async update(@Param("id") id: string, @Body() body: UpdateClientDto, @CurrentUser() user: AuthPrincipal) {
    const result = await this.clients.update(id, { ...body, administratorId: user.userId });
    this.realtime.publishPlatforms(id);
    return result;
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  deactivate(@Param("id") id: string) { return this.clients.deactivate(id); }
}
