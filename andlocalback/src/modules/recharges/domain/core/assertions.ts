import { DomainError } from "./domain-error";

export function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new DomainError("REQUIRED_FIELD", `${field} es obligatorio`);
  }
}

export function cloneDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new DomainError("INVALID_DATE", "La fecha no es valida");
  }
  return new Date(value.getTime());
}
