import { ManagerScope } from "../../../../common/access/manager-scope";
import { ClientProfileInput } from "../../domain/client-profile";
import { PreparedCredentials } from "./client-credentials.port";
import { AccountType, AdvertisingPlatform } from "../../../recharges/domain/recharge.types";

export type AdminClientView = {
  id: string;
  name: string;
  email: string;
  manager: { id: string; username: string } | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  platformsVersion?: number;
  account: {
    id: string;
    type: AccountType;
    status: "ACTIVE" | "INACTIVE";
    creditDays: number;
    platforms: AdvertisingPlatform[];
  };
  totalRecharged: number;
};

export type UpdateClientInput = Partial<ClientProfileInput> & { status?: "ACTIVE" | "INACTIVE"; expectedPlatformsVersion?: number; administratorId?: string };

export interface ClientAdminRepository {
  /* Cliente, cuenta, pautas y usuario se escriben juntos: un cliente sin
     acceso es un estado que no deberia existir ni un instante. */
  create(input: ClientProfileInput, credentials: Pick<PreparedCredentials, "username" | "passwordHash">, managerId: string | null): Promise<AdminClientView>;
  /* El alcance recorta la consulta en la base, no la respuesta: un cliente
     ajeno no llega nunca al proceso, asi que no puede escaparse por error. */
  list(scope: ManagerScope): Promise<AdminClientView[]>;
  findById(id: string, scope: ManagerScope): Promise<AdminClientView | null>;
  update(id: string, input: UpdateClientInput): Promise<AdminClientView | null>;
  deactivate(id: string): Promise<AdminClientView | null>;
  /* null desvincula: el cliente vuelve a la bandeja de sin asignar. Devuelve
     undefined si el gestor propuesto no existe o no esta activo, para que el
     caso de uso lo distinga de un cliente inexistente. */
  assignManager(id: string, managerId: string | null): Promise<AdminClientView | null | undefined>;
}

export const CLIENT_ADMIN_REPOSITORY = Symbol("CLIENT_ADMIN_REPOSITORY");
