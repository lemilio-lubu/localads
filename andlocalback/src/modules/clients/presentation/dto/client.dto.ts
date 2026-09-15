import { IsArray, IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { AccountType, AdvertisingPlatform, ClientStatus } from "../../../recharges/domain/recharge.types";

export class CreateClientDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsEmail() email!: string;
  @IsEnum(AccountType) accountType!: AccountType;
  @IsArray() @IsEnum(AdvertisingPlatform, { each: true }) platforms!: AdvertisingPlatform[];
  @IsOptional() @IsInt() @Min(0) @Max(365) creditDays = 0;
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
