/* Contrato de la API REST v1 de Migo (https://apidocs.migo.com.ec), solo con
   los campos que usa localads. Los montos viajan como número con dos
   decimales; Migo recalcula y rechaza con TOTALS_MISMATCH si no cuadran. */

export type MigoInvoiceStatus = "CREATED" | "SENT" | "SENT_TO_SRI" | "AUTHORIZED" | "NOT_AUTHORIZED" | "ERROR" | "VOIDED";

export type MigoInvoiceLineRequest = {
  product: { id: number };
  referenceCode?: string;
  description: string;
  quantity: number;
  priceUnit: number;
  discountAmount: number;
  subtotalAmount: number;
  taxAmount: number;
  iceAmount: number;
  totalAmount: number;
  tax: { id: number; rate: number };
};

export type MigoPaymentRequest = {
  amount: number;
  paymentMethod: { id: number };
  paymentTerm?: { id: number };
};

export type MigoInvoiceRequest = {
  documentType: "INVOICE";
  invoiceUuid: string;
  issueDate: string;
  emissionPointId: number;
  vendorId?: number;
  activityId?: number;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  tipAmount: number;
  observation?: string;
  customer: { id: number; identificationNumber: string; socialReason: string };
  details: MigoInvoiceLineRequest[];
  payments?: MigoPaymentRequest[];
  additionalInfo?: { label: string; value: string }[];
};

/* POST /api/v1/invoices (InvoicePresenter) y GET /api/v1/invoices/{id}
   (InvoiceDetailPresenter, que además trae sriStatus y sriMessage). */
export type MigoInvoiceResponse = {
  id: number;
  number?: string | null;
  status: MigoInvoiceStatus;
  authorizationKey?: string | null;
  accessKey?: string | null;
  issueDate?: string | null;
  sriStatus?: string | null;
  sriMessage?: string | null;
  messages?: string[] | null;
};

export type MigoCustomer = {
  id: number;
  socialReason: string;
  identificationNumber: string;
  email?: string | null;
  active: boolean;
};

export type MigoCustomerRequest = {
  identificationNumber: string;
  identificationTypeId: number;
  customerGroupId: number;
  socialReason: string;
  email?: string;
  /* Migo los rechaza vacíos al dar de alta: «No puede estar en blanco». */
  address: string;
  phone: string;
};

export type MigoPage<T> = {
  data: T[];
  pagination: { page: number; size: number; totalElements: number; totalPages: number };
};

export type MigoErrorBody = {
  status?: number;
  error?: string;
  message?: string;
  errors?: { field: string; message: string }[];
  details?: unknown;
};
