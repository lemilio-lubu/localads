import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseFilters } from "@nestjs/common";
import { ApplicationErrorFilter } from "../../recharges/presentation/application-error.filter";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { ManageTeam } from "../application/use-cases/manage-team";
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
    return this.team.update(id, body);
  }

  @Post(":id/password-reset")
  @HttpCode(HttpStatus.OK)
  resetPassword(@Param("id") id: string) { return this.team.resetPassword(id); }
}
