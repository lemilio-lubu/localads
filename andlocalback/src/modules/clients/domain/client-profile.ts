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
  /* Opcionales. Vacío se guarda como null. */
  address?: string | null;
  phone?: string | null;
};

const PHONE = /^\+?[0-9(][0-9 ()-]{5,18}[0-9]$/;

/** Dirección o teléfono recortados; el texto vacío significa «sin dato». */
export function optionalContact(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function validateClientProfile(input: ClientProfileInput, options: { requirePostpaidLimit?: boolean } = {}) {
  if (input.accountType === AccountType.PREPAID && input.creditDays !== 0) {
    throw new ApplicationError("INVALID_CREDIT_DAYS", "Una cuenta prepago no puede tener días de crédito");
  }
  if (input.accountType === AccountType.POSTPAID && input.creditDays <= 0) {
    throw new ApplicationError("INVALID_CREDIT_DAYS", "Una cuenta pospago requiere al menos un día de crédito");
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
    throw new ApplicationError("INVALID_CREDIT_LIMIT", "Una cuenta pospago requiere una línea de crédito mayor que cero");
  }
  if (input.address && input.address.length > 200) {
    throw new ApplicationError("INVALID_ADDRESS", "La dirección admite como mucho 200 caracteres");
  }
  if (input.phone && !PHONE.test(input.phone)) {
    throw new ApplicationError("INVALID_PHONE", "El teléfono debe tener entre 7 y 20 caracteres: números, espacios, guiones, paréntesis y un + inicial");
  }
  if (new Set(input.platforms).size !== input.platforms.length) {
    throw new ApplicationError("DUPLICATED_PLATFORM", "Una plataforma no puede repetirse");
  }
}
