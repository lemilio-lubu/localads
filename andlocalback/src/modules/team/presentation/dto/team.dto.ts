import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { TEAM_ROLES } from "../../domain/team-member";

export class ListTeamQueryDto {
  @IsOptional() @IsIn([...TEAM_ROLES]) role?: "ADMIN" | "GESTOR";
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE"]) status?: "ACTIVE" | "INACTIVE";
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

export class CreateTeamMemberDto {
  @IsString() @MinLength(3) @MaxLength(24) username!: string;
  @IsIn([...TEAM_ROLES]) role!: "ADMIN" | "GESTOR";
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateTeamMemberDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(24) username?: string;
  @IsOptional() @IsIn([...TEAM_ROLES]) role?: "ADMIN" | "GESTOR";
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE"]) status?: "ACTIVE" | "INACTIVE";
}
