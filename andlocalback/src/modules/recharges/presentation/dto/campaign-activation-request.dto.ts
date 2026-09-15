import { Transform } from "class-transformer";
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { ActivationRequestStatus } from "../../domain/model/domain-status";
import { AdvertisingPlatform } from "../../domain/recharge.types";

const positiveMoneyPattern = /^(?:0*[1-9]\d*(?:\.\d{1,2})?|0+\.(?:0[1-9]|[1-9]\d?))$/;
const phonePattern = /^\+?[0-9][0-9 ()-]{5,18}[0-9]$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateCampaignActivationRequestDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  accountId!: string;

  @IsEnum(AdvertisingPlatform)
  platform!: AdvertisingPlatform;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  requesterName!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  externalAccountId!: string;

  @Transform(trim)
  @IsString()
  @Matches(phonePattern, { message: "phone debe ser un telefono valido" })
  phone!: string;

  @IsString()
  @Matches(positiveMoneyPattern, {
    message: "firstRechargeAmount debe ser mayor que cero y tener maximo dos decimales",
  })
  firstRechargeAmount!: string;
}

export class ListOwnCampaignActivationRequestsQueryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  accountId!: string;
}

export class ListAdminCampaignActivationRequestsQueryDto {
  @IsOptional()
  @IsEnum(ActivationRequestStatus)
  status?: ActivationRequestStatus;
}

export class CampaignActivationReviewDecisionDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  administratorId!: string;
}

export class CampaignActivationRejectionDto extends CampaignActivationReviewDecisionDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
