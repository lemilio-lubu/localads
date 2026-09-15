import { ApplicationError } from "../../../../common/errors/application.error";
import { PageRequest } from "../ports/phase7-query.ports";

export function requiredQueryId(value: string | undefined, code: string, message: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new ApplicationError(code, message, 400);
  return normalized;
}

export function pagination(page?: number, pageSize?: number): PageRequest {
  const normalizedPage = page ?? 1;
  const normalizedSize = pageSize ?? 20;
  if (!Number.isInteger(normalizedPage) || normalizedPage < 1) {
    throw new ApplicationError("INVALID_PAGE", "La pagina debe ser un entero mayor que cero", 400);
  }
  if (!Number.isInteger(normalizedSize) || normalizedSize < 1 || normalizedSize > 100) {
    throw new ApplicationError("INVALID_PAGE_SIZE", "El tamano de pagina debe estar entre 1 y 100", 400);
  }
  return { page: normalizedPage, pageSize: normalizedSize };
}

export function optionalDate(value: Date | string | undefined, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApplicationError("INVALID_DATE_FILTER", `${field} no es una fecha valida`, 400);
  }
  return parsed;
}

export function assertDateRange(dateFrom?: Date, dateTo?: Date): void {
  if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
    throw new ApplicationError("INVALID_DATE_RANGE", "La fecha inicial no puede superar la fecha final", 400);
  }
}

export function optionalText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
