import { ApplicationError } from "../../../common/errors/application.error";
import { AccountType, AdvertisingPlatform } from "../../recharges/domain/recharge.types";

export type ClientProfileInput = {
  name: string;
  email: string;
  accountType: AccountType;
  platforms: AdvertisingPlatform[];
  creditDays: number;
};

export function validateClientProfile(input: ClientProfileInput) {
  if (input.accountType === AccountType.PREPAID && input.creditDays !== 0) {
    throw new ApplicationError("INVALID_CREDIT_DAYS", "Una cuenta prepago no puede tener días de crédito");
  }
  if (input.accountType === AccountType.POSTPAID && input.creditDays <= 0) {
    throw new ApplicationError("INVALID_CREDIT_DAYS", "Una cuenta postpago requiere al menos un día de crédito");
  }
  if (new Set(input.platforms).size !== input.platforms.length) {
    throw new ApplicationError("DUPLICATED_PLATFORM", "Una plataforma no puede repetirse");
  }
}
