import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { TEAM_ROLES } from "../../domain/team-member";

export class ListTeamQueryDto {
  @IsOptional() @IsIn([...TEAM_ROLES]) role?: "ADMIN" | "GESTOR";
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE"]) status?: "ACTIVE" | "INACTIVE";
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

export class CreateTeamMemberDto {
  @IsString() @MinLength(3) @MaxLength(24) username!: string;
  @IsIn([...TEAM_ROLES]) role!: "ADMIN" | "GESTOR";
}

export class UpdateTeamMemberDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(24) username?: string;
  @IsOptional() @IsIn([...TEAM_ROLES]) role?: "ADMIN" | "GESTOR";
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE"]) status?: "ACTIVE" | "INACTIVE";
  /* Solo se miran al pasar a INACTIVE, y solo si el gestor tiene cartera.
     Son dos campos y no uno que admita null porque «no dijo nada» y «dijo que
     las suelta» tienen que poder distinguirse: esa diferencia es justo la
     regla. */
  @IsOptional() @IsString() @MaxLength(64) reassignTo?: string;
  @IsOptional() @IsBoolean() leaveUnassigned?: boolean;
}
