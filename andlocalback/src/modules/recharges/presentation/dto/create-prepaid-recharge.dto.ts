import { Type } from "class-transformer";
import { IsEnum, IsNumber, IsString, Min } from "class-validator";
import { AdvertisingPlatform } from "../../domain/recharge.types";

export class CreatePrepaidRechargeDto {
  @IsString()
  accountId!: string;

  @IsEnum(AdvertisingPlatform)
  platform!: AdvertisingPlatform;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
}
