import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseFilters } from "@nestjs/common";
import { ApplicationErrorFilter } from "../../recharges/presentation/application-error.filter";
import { ManageClients } from "../application/use-cases/manage-clients";
import { AssignManagerDto, CreateClientDto, ListClientsQueryDto, UpdateClientDto } from "./dto/client.dto";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { scopeFor, withUnassigned } from "../../../common/access/manager-scope";
import { TransactionsGateway } from "../../recharges/presentation/transactions.gateway";

/* El gestor comparte la pantalla con el admin; lo que cambia es el alcance,
   que sale del token en cada metodo. */
@Controller("admin/clients")
@Roles("ADMIN", "GESTOR")
@UseFilters(ApplicationErrorFilter)
export class ClientsController {
  constructor(private readonly clients: ManageClients, private readonly realtime: TransactionsGateway) {}

  @Get() list(@Query() query: ListClientsQueryDto, @CurrentUser() user: AuthPrincipal) {
    return this.clients.list(withUnassigned(scopeFor(user), query.owner === "unassigned"));
  }
  @Get(":id") get(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) { return this.clients.get(id, scopeFor(user)); }
  @Post() create(@Body() body: CreateClientDto, @CurrentUser() user: AuthPrincipal) { return this.clients.create(body, scopeFor(user), body.managerId); }
  @Patch(":id") async update(@Param("id") id: string, @Body() body: UpdateClientDto, @CurrentUser() user: AuthPrincipal) {
    const result = await this.clients.update(id, { ...body, administratorId: user.userId }, scopeFor(user));
    this.realtime.publishPlatforms(id);
    return result;
  }

  /* Reasignar un cliente a otro gestor es exclusivo del admin; el resto del
     controlador lo comparten los dos roles. */
  @Post(":id/manager")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  assignManager(@Param("id") id: string, @Body() body: AssignManagerDto) {
    return this.clients.assignManager(id, body.managerId ?? null);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  deactivate(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) { return this.clients.deactivate(id, scopeFor(user)); }
}
