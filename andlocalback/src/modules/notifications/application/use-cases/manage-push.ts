import { ApplicationError } from "../../../../common/errors/application.error";
import { AuthRole } from "../../../auth/auth.types";
import { isAllowedPushEndpoint, preferenceGroupsFor } from "../../domain/notification-preferences";
import { NotificationPreferenceStorePort, PushSenderPort, PushSubscriptionStorePort } from "../ports/push.ports";

/* Todo va recortado por el usuario del token: ningún comando acepta otro userId. */

export type PreferenceView = Readonly<{ key: string; label: string; push: boolean }>;

export class GetNotificationPreferences {
  constructor(private readonly preferences: NotificationPreferenceStorePort, private readonly sender: PushSenderPort) {}

  async execute(command: Readonly<{ userId: string; role: AuthRole }>): Promise<Readonly<{ pushAvailable: boolean; publicKey: string | null; groups: readonly PreferenceView[] }>> {
    const disabled = (await this.preferences.disabledTypes([command.userId])).get(command.userId) ?? new Set<string>();
    return {
      pushAvailable: this.sender.publicKey !== null,
      publicKey: this.sender.publicKey,
      /* Un grupo está encendido si ninguno de sus tipos está apagado. */
      groups: preferenceGroupsFor(command.role).map((group) => ({ key: group.key, label: group.label, push: group.types.every((type) => !disabled.has(type)) })),
    };
  }
}

export class UpdateNotificationPreference {
  constructor(private readonly preferences: NotificationPreferenceStorePort) {}

  async execute(command: Readonly<{ userId: string; role: AuthRole; key: string; push: boolean }>): Promise<void> {
    const group = preferenceGroupsFor(command.role).find((item) => item.key === command.key);
    if (!group) throw new ApplicationError("NOTIFICATION_PREFERENCE_UNKNOWN", "Ese tipo de aviso no existe para tu cuenta", 400);
    await this.preferences.setPush(command.userId, group.types, command.push);
  }
}

const MAX_KEY_LENGTH = 256;

export type RegisterPushCommand = Readonly<{ userId: string; endpoint: string; p256dh: string; auth: string; userAgent: string | null }>;

export class RegisterPushSubscription {
  constructor(private readonly subscriptions: PushSubscriptionStorePort, private readonly sender: PushSenderPort) {}

  async execute(command: RegisterPushCommand): Promise<void> {
    if (!this.sender.publicKey) throw new ApplicationError("PUSH_UNAVAILABLE", "Los avisos en el dispositivo no están disponibles todavía", 409);
    if (!isAllowedPushEndpoint(command.endpoint)) throw new ApplicationError("PUSH_ENDPOINT_INVALID", "Este navegador no es compatible con los avisos", 400);
    if (!command.p256dh || !command.auth || command.p256dh.length > MAX_KEY_LENGTH || command.auth.length > MAX_KEY_LENGTH) {
      throw new ApplicationError("PUSH_ENDPOINT_INVALID", "Este navegador no es compatible con los avisos", 400);
    }
    await this.subscriptions.upsert({ ...command, userAgent: command.userAgent?.slice(0, 300) ?? null });
  }
}

export class RemovePushSubscription {
  constructor(private readonly subscriptions: PushSubscriptionStorePort) {}

  execute(command: Readonly<{ userId: string; endpoint: string }>): Promise<void> {
    return this.subscriptions.remove(command.userId, command.endpoint);
  }
}
