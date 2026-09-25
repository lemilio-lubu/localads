import { IsArray, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { AccountType, AdvertisingPlatform, ClientStatus } from "../../../recharges/domain/recharge.types";

export class CreateClientDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsEmail() email!: string;
  /* Solo forma y largo: la regla del SRI vive en el dominio (validateRuc),
     que da el motivo concreto del rechazo. */
  @IsString({ message: "El RUC es obligatorio" }) @MaxLength(20, { message: "El RUC debe tener 13 dígitos" }) ruc!: string;
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
  @IsOptional() @IsString({ message: "El RUC debe ser texto" }) @MaxLength(20, { message: "El RUC debe tener 13 dígitos" }) ruc?: string;
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

/* `owner=unassigned` es el cubo de clientes sin gestor. Vive en la query y no
   en el token porque es un filtro que elige quien mira, no su autoridad. */
export class ListClientsQueryDto {
  @IsOptional() @IsIn(["unassigned"]) owner?: "unassigned";
}
