import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

/* Los limites duplican los del dominio a proposito: el DTO corta lo absurdo
   en la entrada y el dominio dice el motivo concreto de lo demas. */
export class UpdatePaymentAccountDto {
  @IsString() @MaxLength(80) bankName!: string;
  @IsString() @MaxLength(60) accountType!: string;
  @IsString() @MaxLength(40) accountNumber!: string;
  @IsString() @MaxLength(120) holderName!: string;
  @IsString() @MaxLength(20) holderTaxId!: string;
  @IsOptional() @IsEmail() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
}
