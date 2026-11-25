/* Aviso a las pantallas abiertas de que algo de un cliente cambió y conviene
   volver a pedir sus datos. No lleva datos: cada pantalla consulta lo suyo con
   sus propios permisos. Es una mejora sobre pantallas que también se recargan
   solas, así que publicar nunca falla ni retrasa a quien llama. */
export interface PlatformRealtimePublisher {
  publishPlatforms(clientId: string): void;
  /* Cuando quien publica solo conoce la transacción o la factura, el cliente
     se resuelve aparte, sin esperar. */
  publishTransaction(transactionId: string): void;
  publishInvoice(invoiceId: string): void;
}

export const PLATFORM_REALTIME_PUBLISHER = Symbol("PLATFORM_REALTIME_PUBLISHER");

export const silentPlatformRealtime: PlatformRealtimePublisher = {
  publishPlatforms: () => undefined,
  publishTransaction: () => undefined,
  publishInvoice: () => undefined,
};

/* La pregunta inversa que necesita ese reparto: ¿de qué cliente es? */
export interface RealtimeClientLookupPort {
  clientOfTransaction(transactionId: string): Promise<string | null>;
  clientOfInvoice(invoiceId: string): Promise<string | null>;
}

export const REALTIME_CLIENT_LOOKUP = Symbol("REALTIME_CLIENT_LOOKUP");
