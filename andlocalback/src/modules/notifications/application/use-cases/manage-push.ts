import { ApplicationError } from "../../../../common/errors/application.error";
import { AuthRole } from "../../../auth/auth.types";
import { emailTypesOf, isAllowedPushEndpoint, NotificationChannelName, preferenceGroupsFor } from "../../domain/notification-preferences";
import { EmailSenderPort } from "../ports/email.ports";
import { NotificationPreferenceStorePort, PushSenderPort, PushSubscriptionStorePort } from "../ports/push.ports";

/* Todo va recortado por el usuario del token: ningún comando acepta otro userId. */

/* email null: ese grupo no tiene correo para el rol. */
export type PreferenceView = Readonly<{ key: string; label: string; push: boolean; email: boolean | null }>;

export class GetNotificationPreferences {
  constructor(
    private readonly preferences: NotificationPreferenceStorePort,
    private readonly push: PushSenderPort,
    private readonly email: EmailSenderPort,
  ) {}

  async execute(command: Readonly<{ userId: string; role: AuthRole }>): Promise<Readonly<{
    pushAvailable: boolean;
    publicKey: string | null;
    emailAvailable: boolean;
    groups: readonly PreferenceView[];
  }>> {
    const disabled = (await this.preferences.disabledTypes([command.userId])).get(command.userId);
    return {
      pushAvailable: this.push.publicKey !== null,
      publicKey: this.push.publicKey,
      emailAvailable: this.email.enabled,
      /* Un canal de un grupo está encendido si ninguno de sus tipos está apagado. */
      groups: preferenceGroupsFor(command.role).map((group) => {
        const emailTypes = emailTypesOf(command.role, group);
        return {
          key: group.key,
          label: group.label,
          push: group.types.every((type) => !disabled?.push.has(type)),
          email: emailTypes.length === 0 ? null : emailTypes.every((type) => !disabled?.email.has(type)),
        };
      }),
    };
  }
}

export class UpdateNotificationPreference {
  constructor(private readonly preferences: NotificationPreferenceStorePort) {}

  async execute(command: Readonly<{ userId: string; role: AuthRole; key: string; channel: NotificationChannelName; enabled: boolean }>): Promise<void> {
    const group = preferenceGroupsFor(command.role).find((item) => item.key === command.key);
    if (!group) throw new ApplicationError("NOTIFICATION_PREFERENCE_UNKNOWN", "Ese tipo de aviso no existe para tu cuenta", 400);
    /* El correo solo se guarda en los tipos que lo tienen: así no queda una
       elección sobre un canal que ese aviso no usa. */
    const types = command.channel === "email" ? emailTypesOf(command.role, group) : group.types;
    if (types.length === 0) throw new ApplicationError("NOTIFICATION_PREFERENCE_UNKNOWN", "Ese aviso no se envía por correo", 400);
    await this.preferences.setEnabled(command.userId, types, command.channel, command.enabled);
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
