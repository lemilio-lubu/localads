import { ApplicationError } from "../../../common/errors/application.error";
import { validateRuc } from "../../clients/domain/ruc";

/* Cuenta a la que los clientes transfieren. Lo que se guarda es lo que el
   cliente tiene que teclear en su banco, tal cual: por eso se normaliza al
   guardar y no al mostrar. */
export type PaymentAccountInput = Readonly<{
  bankName: string;
  accountType: string;
  accountNumber: string;
  holderName: string;
  holderTaxId: string;
  email?: string | null;
  phone?: string | null;
}>;

export type NormalizedPaymentAccount = Readonly<{
  bankName: string;
  accountType: string;
  accountNumber: string;
  holderName: string;
  holderTaxId: string;
  email: string | null;
  phone: string | null;
}>;

const invalid = (message: string) => new ApplicationError("INVALID_PAYMENT_ACCOUNT", message);
const collapse = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

function text(value: string, label: string, min: number, max: number): string {
  const clean = collapse(value);
  if (clean.length < min) throw invalid(`${label} es obligatorio`);
  if (clean.length > max) throw invalid(`${label} admite hasta ${max} caracteres`);
  return clean;
}

export function normalizePaymentAccount(input: PaymentAccountInput): NormalizedPaymentAccount {
  const accountNumber = collapse(input.accountNumber).replace(/[\s-]/g, "");
  if (!/^\d{6,20}$/.test(accountNumber)) throw invalid("El número de cuenta debe tener entre 6 y 20 dígitos");

  const email = collapse(input.email).toLowerCase();
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw invalid("El correo no es válido");

  const phone = collapse(input.phone).replace(/[\s-]/g, "");
  if (phone && !/^\+?\d{7,15}$/.test(phone)) throw invalid("El celular debe tener entre 7 y 15 dígitos");

  return {
    bankName: text(input.bankName, "El banco", 2, 80),
    accountType: text(input.accountType, "El tipo de cuenta", 2, 60),
    accountNumber,
    holderName: text(input.holderName, "El titular", 3, 120),
    holderTaxId: validateRuc(input.holderTaxId),
    email: email || null,
    phone: phone || null,
  };
}
