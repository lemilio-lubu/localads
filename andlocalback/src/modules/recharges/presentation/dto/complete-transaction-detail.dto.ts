import { IsDateString, IsOptional, IsString, Matches } from "class-validator";

const positiveMoneyPattern = /^(?:0*[1-9]\d*(?:\.\d{1,2})?|0+\.(?:0[1-9]|[1-9]\d?))$/;

/** Public input for recording the effective result of one pauta recharge. */
export class CompleteTransactionDetailDto {
  @IsString()
  @Matches(positiveMoneyPattern, {
    message: "effectiveAmount debe ser mayor que cero y tener maximo dos decimales",
  })
  effectiveAmount!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveRechargeDate?: string;
}
