import { Prisma } from "@prisma/client";
import { BusinessEvent } from "./business-events";

/* Se llama SIEMPRE con el cliente de la transacción en curso (`database`
   dentro de `$transaction`), nunca con el PrismaService suelto: lo que da
   sentido al outbox es que el hecho y el cambio se confirman o se descartan
   juntos. */
export async function appendBusinessEvents(database: Prisma.TransactionClient, ...events: readonly BusinessEvent[]): Promise<void> {
  if (events.length === 0) return;
  /* Fechas puestas por la aplicación (UTC), como el resto de columnas: el
     default de la base usaría la zona horaria de la sesión. */
  const now = new Date();
  await database.outboxEvent.createMany({
    data: events.map(({ type, ...payload }) => ({ type, payload: payload as Prisma.InputJsonObject, occurredAt: now, availableAt: now })),
  });
}
