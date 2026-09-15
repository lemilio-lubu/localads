import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class ApproveTransactionVerificationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  administratorId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RejectTransactionVerificationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  administratorId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class ReviewTransactionVerificationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  administratorId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
