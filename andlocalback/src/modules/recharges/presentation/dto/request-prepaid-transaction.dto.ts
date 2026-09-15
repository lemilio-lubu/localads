import { plainToInstance, Transform } from "class-transformer";
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
import { ApplicationError } from "../../../../common/errors/application.error";
import { AdvertisingPlatform } from "../../domain/recharge.types";

const positiveMoneyPattern = /^(?:0*[1-9]\d*(?:\.\d{1,2})?|0+\.(?:0[1-9]|[1-9]\d?))$/;

export class RequestPrepaidTransactionDetailDto {
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

export class RequestPrepaidTransactionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  accountId!: string;

  @Transform(({ value }) => {
    const parsed = parseDetails(value);
    return Array.isArray(parsed)
      ? parsed.map((detail) => plainToInstance(RequestPrepaidTransactionDetailDto, detail))
      : parsed;
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  details!: RequestPrepaidTransactionDetailDto[];
}

function parseDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new ApplicationError("INVALID_DETAILS_JSON", "Los detalles deben contener JSON valido");
  }
}
