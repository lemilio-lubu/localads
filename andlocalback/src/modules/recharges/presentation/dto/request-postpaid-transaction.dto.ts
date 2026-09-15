import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { AdvertisingPlatform } from "../../domain/recharge.types";

const positiveMoneyPattern = /^(?:0*[1-9]\d*(?:\.\d{1,2})?|0+\.(?:0[1-9]|[1-9]\d?))$/;

export class RequestPostpaidTransactionDetailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  pautaId!: string;

  @IsEnum(AdvertisingPlatform)
  platform!: AdvertisingPlatform;

  @IsString()
  @Matches(positiveMoneyPattern, {
    message: "amount debe ser mayor que cero y tener maximo dos decimales",
  })
  amount!: string;
}

/** JSON payload for a postpaid transaction. It intentionally accepts no clientId or receipt. */
export class RequestPostpaidTransactionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  accountId!: string;

  @Type(() => RequestPostpaidTransactionDetailDto)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  details!: RequestPostpaidTransactionDetailDto[];
}
