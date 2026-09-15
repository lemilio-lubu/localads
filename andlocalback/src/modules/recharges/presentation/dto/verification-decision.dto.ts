import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class ApproveVerificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  administratorId!: string;
}

export class RejectVerificationDto extends ApproveVerificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
