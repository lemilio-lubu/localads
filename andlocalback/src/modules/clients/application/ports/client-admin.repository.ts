import { ClientProfileInput } from "../../domain/client-profile";
import { AccountType, AdvertisingPlatform } from "../../../recharges/domain/recharge.types";

export type AdminClientView = {
  id: string;
  name: string;
  email: string;
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
  create(input: ClientProfileInput): Promise<AdminClientView>;
  list(): Promise<AdminClientView[]>;
  findById(id: string): Promise<AdminClientView | null>;
  update(id: string, input: UpdateClientInput): Promise<AdminClientView | null>;
  deactivate(id: string): Promise<AdminClientView | null>;
}

export const CLIENT_ADMIN_REPOSITORY = Symbol("CLIENT_ADMIN_REPOSITORY");
