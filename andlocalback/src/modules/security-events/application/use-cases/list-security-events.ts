import { ApplicationError } from "../../../../common/errors/application.error";
import { actionsByCategory, SecurityEventCategory, SecurityEventPage, SecurityEventsQuery } from "../ports/security-events.query";

export const securityEventsPageSize = 25;

export type ListSecurityEventsInput = Readonly<{ category?: SecurityEventCategory; problemsOnly?: boolean; search?: string; page?: number }>;

/* Lectura del registro de seguridad para el admin. Solo lee: el registro no
   se corrige ni se borra desde ninguna pantalla. */
export class ListSecurityEvents {
  constructor(private readonly events: SecurityEventsQuery) {}

  async execute(input: ListSecurityEventsInput): Promise<SecurityEventPage> {
    const page = input.page ?? 1;
    if (!Number.isInteger(page) || page < 1) throw new ApplicationError("INVALID_PAGE", "La página no es válida");
    const search = input.search?.trim();
    return this.events.list({
      ...(input.category ? { actions: actionsByCategory[input.category] } : {}),
      problemsOnly: input.problemsOnly === true,
      ...(search ? { search } : {}),
      page,
      pageSize: securityEventsPageSize,
    });
  }
}
