import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CredentialsService } from "../auth/credentials.service";
import { TEAM_CREDENTIALS_ISSUER, TeamCredentialsIssuer } from "./application/ports/team-credentials.port";
import { TEAM_REPOSITORY, TeamRepository } from "./application/ports/team.repository";
import { ManageTeam } from "./application/use-cases/manage-team";
import { PrismaTeamRepository } from "./infrastructure/prisma-team.repository";
import { TeamController } from "./presentation/team.controller";

@Module({
  imports: [AuthModule],
  controllers: [TeamController],
  providers: [
    PrismaTeamRepository,
    { provide: TEAM_REPOSITORY, useExisting: PrismaTeamRepository },
    { provide: TEAM_CREDENTIALS_ISSUER, useExisting: CredentialsService },
    {
      provide: ManageTeam,
      inject: [TEAM_REPOSITORY, TEAM_CREDENTIALS_ISSUER],
      useFactory: (team: TeamRepository, credentials: TeamCredentialsIssuer) => new ManageTeam(team, credentials),
    },
  ],
})
export class TeamModule {}
