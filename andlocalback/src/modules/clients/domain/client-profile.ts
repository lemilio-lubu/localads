import { ApplicationError } from "../../../common/errors/application.error";
import { AccountType, AdvertisingPlatform } from "../../recharges/domain/recharge.types";

export type ClientProfileInput = {
  name: string;
  email: string;
  ruc: string;
  accountType: AccountType;
  platforms: AdvertisingPlatform[];
  creditDays: number;
  creditLimit?: number;
};

export function validateClientProfile(input: ClientProfileInput, options: { requirePostpaidLimit?: boolean } = {}) {
  if (input.accountType === AccountType.PREPAID && input.creditDays !== 0) {
    throw new ApplicationError("INVALID_CREDIT_DAYS", "Una cuenta prepago no puede tener días de crédito");
  }
  if (input.accountType === AccountType.POSTPAID && input.creditDays <= 0) {
    throw new ApplicationError("INVALID_CREDIT_DAYS", "Una cuenta postpago requiere al menos un día de crédito");
  }
  const creditLimit = input.creditLimit ?? 0;
  const cents = Math.round(creditLimit * 100);
  if (!Number.isFinite(creditLimit) || creditLimit < 0 || !Number.isSafeInteger(cents) || Math.abs(creditLimit * 100 - cents) > 1e-7) {
    throw new ApplicationError("INVALID_CREDIT_LIMIT", "La línea de crédito debe ser un monto válido con máximo dos decimales");
  }
  if (input.accountType === AccountType.PREPAID && cents !== 0) {
    throw new ApplicationError("INVALID_CREDIT_LIMIT", "Una cuenta prepago no puede tener línea de crédito");
  }
  if (options.requirePostpaidLimit && input.accountType === AccountType.POSTPAID && cents <= 0) {
    throw new ApplicationError("INVALID_CREDIT_LIMIT", "Una cuenta postpago requiere una línea de crédito mayor que cero");
  }
  if (new Set(input.platforms).size !== input.platforms.length) {
    throw new ApplicationError("DUPLICATED_PLATFORM", "Una plataforma no puede repetirse");
  }
}
