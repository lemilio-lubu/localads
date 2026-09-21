import { IsArray, IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { AccountType, AdvertisingPlatform, ClientStatus } from "../../../recharges/domain/recharge.types";

export class CreateClientDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsEmail() email!: string;
  @IsEnum(AccountType) accountType!: AccountType;
  @IsArray() @IsEnum(AdvertisingPlatform, { each: true }) platforms!: AdvertisingPlatform[];
  @IsOptional() @IsInt() @Min(0) @Max(365) creditDays = 0;
  /* Solo lo aplica un admin. Un gestor se asigna a si mismo desde el token y
     lo que venga aqui se ignora: el alcance no se amplia por el cuerpo. */
  @IsOptional() @IsString() @MaxLength(60) managerId?: string;
}

export class UpdateClientDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(AccountType) accountType?: AccountType;
  @IsOptional() @IsArray() @IsEnum(AdvertisingPlatform, { each: true }) platforms?: AdvertisingPlatform[];
  @ValidateIf((input: UpdateClientDto) => input.platforms !== undefined) @IsInt() @Min(0) expectedPlatformsVersion?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) creditDays?: number;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
}

export class AssignManagerDto {
  /* Null es una asignacion valida: desvincular deja al cliente en la bandeja
     de sin asignar que revisa el admin. */
  @IsOptional() @IsString() @MaxLength(60) managerId?: string | null;
}
