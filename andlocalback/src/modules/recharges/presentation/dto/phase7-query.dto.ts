import { Transform } from "class-transformer";
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import {
  TransactionPaymentStatus,
  TransactionRechargeStatus,
} from "../../domain/model/domain-status";
import { AccountType, VerificationStatus } from "../../domain/recharge.types";

export enum VerificationScopeDto { ALL = "ALL", REVIEW = "REVIEW", APPROVED = "APPROVED", REJECTED = "REJECTED" }

const trimmedOptionalString = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() || undefined : value;

export class PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class TransactionFiltersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TransactionRechargeStatus)
  rechargeStatus?: TransactionRechargeStatus;

  @IsOptional()
  @IsEnum(TransactionPaymentStatus)
  paymentStatus?: TransactionPaymentStatus;

  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}

/* El cliente filtra su propio historial. No lleva clientId: la identidad sale
   del token, nunca de la query. */
export class MyTransactionsQueryDto extends TransactionFiltersQueryDto {
  @IsOptional()
  @Transform(trimmedOptionalString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  search?: string;
}

export class AdminTransactionsQueryDto extends TransactionFiltersQueryDto {
  /* Cubo del admin: registros de clientes sin gestor. */
  @IsOptional() @IsIn(["unassigned"]) owner?: "unassigned";

  @IsOptional()
  @Transform(trimmedOptionalString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  search?: string;

  @IsOptional()
  @Transform(trimmedOptionalString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  clientId?: string;

  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;
}

export class AdminVerificationsQueryDto extends PaginationQueryDto {
  /* Cubo del admin: registros de clientes sin gestor. */
  @IsOptional() @IsIn(["unassigned"]) owner?: "unassigned";

  @IsOptional()
  @IsEnum(VerificationScopeDto)
  scope: VerificationScopeDto = VerificationScopeDto.REVIEW;

  @IsOptional()
  @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  @IsOptional()
  @Transform(trimmedOptionalString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  search?: string;

  @IsOptional()
  @Transform(trimmedOptionalString)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  clientId?: string;

  @IsOptional()
  @Transform(trimmedOptionalString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  bank?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}
