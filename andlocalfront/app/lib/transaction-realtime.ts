export type VerificationRealtimeEvent = Readonly<{
  eventId: string;
  verificationId: string;
  transactionId: string;
  status: "EN_REVISION" | "VERIFICADA_AUTOMATICAMENTE" | "APROBADA" | "RECHAZADA";
  paymentStatus: "PENDING" | "IN_CREDIT" | "UNDER_REVIEW" | "PAID" | "OVERDUE" | "REJECTED";
  rechargeStatus: "REQUESTED" | "UNDER_REVIEW" | "APPROVED" | "PROCESSING" | "COMPLETED" | "REJECTED";
  reason: string | null;
  version: number;
  occurredAt: string;
}>;
