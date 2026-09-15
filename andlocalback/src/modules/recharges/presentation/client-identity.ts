import { ApplicationError } from "../../../common/errors/application.error";

const clientIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

/** Temporary identity boundary. Phase 10 will replace this header with authenticated claims. */
export function requireClientId(rawClientId: string | undefined): string {
  const clientId = rawClientId?.trim();
  if (!clientId) {
    throw new ApplicationError("CLIENT_ID_REQUIRED", "El encabezado x-client-id es obligatorio");
  }
  if (!clientIdPattern.test(clientId)) {
    throw new ApplicationError("INVALID_CLIENT_ID", "El encabezado x-client-id no es valido");
  }
  return clientId;
}
