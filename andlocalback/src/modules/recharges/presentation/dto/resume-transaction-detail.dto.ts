import { IsInt, Min } from "class-validator";

export class ResumeTransactionDetailDto {
  @IsInt() @Min(0) expectedVersion!: number;
}
