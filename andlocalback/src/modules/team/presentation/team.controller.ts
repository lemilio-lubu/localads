import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseFilters } from "@nestjs/common";
import { ApplicationErrorFilter } from "../../recharges/presentation/application-error.filter";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { ManageTeam } from "../application/use-cases/manage-team";
import { PortfolioDestination } from "../application/ports/team.repository";
import { CreateTeamMemberDto, ListTeamQueryDto, UpdateTeamMemberDto } from "./dto/team.dto";

/* Equipo = usuarios internos. Solo lo ve el admin: un gestor no administra a
   nadie del equipo, ni siquiera a si mismo. */
@Controller("admin/team")
@Roles("ADMIN")
@UseFilters(ApplicationErrorFilter)
export class TeamController {
  constructor(private readonly team: ManageTeam) {}

  @Get() list(@Query() query: ListTeamQueryDto) { return this.team.list(query); }
  @Get(":id") get(@Param("id") id: string) { return this.team.get(id); }

  @Post() create(@Body() body: CreateTeamMemberDto, @CurrentUser() user: AuthPrincipal) {
    return this.team.create(body, user.userId);
  }

  @Patch(":id") update(@Param("id") id: string, @Body() body: UpdateTeamMemberDto) {
    const { reassignTo, leaveUnassigned, ...rest } = body;
    return this.team.update(id, { ...rest, ...(portfolioOf(reassignTo, leaveUnassigned) ?? {}) });
  }

  @Post(":id/password-reset")
  @HttpCode(HttpStatus.OK)
  resetPassword(@Param("id") id: string) { return this.team.resetPassword(id); }
}

/* Sin ninguno de los dos campos devuelve undefined, y esa ausencia es la que
   hace saltar la regla mas abajo. Reasignar gana a soltar si llegan los dos:
   quien escribe un destino concreto esta diciendo algo mas preciso. */
function portfolioOf(reassignTo?: string, leaveUnassigned?: boolean): Readonly<{ portfolio: PortfolioDestination }> | undefined {
  if (reassignTo?.trim()) return { portfolio: { kind: "reassign", managerId: reassignTo.trim() } };
  if (leaveUnassigned) return { portfolio: { kind: "release" } };
  return undefined;
}
