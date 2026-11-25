import { Module } from "@nestjs/common";
import { RechargesModule } from "../recharges/recharges.module";
import {
  NOTIFICATION_REALTIME,
  NOTIFICATION_STORE,
  NotificationRealtimePort,
  NotificationStorePort,
  OUTBOX_READER,
  OutboxReaderPort,
  RECIPIENT_DIRECTORY,
  RecipientDirectoryPort,
} from "./application/ports/notification.ports";
import {
  NOTIFICATION_PREFERENCE_STORE,
  NotificationPreferenceStorePort,
  PUSH_SENDER,
  PUSH_SUBSCRIPTION_STORE,
  PushSenderPort,
  PushSubscriptionStorePort,
} from "./application/ports/push.ports";
import {
  EMAIL_DELIVERY_STORE,
  EMAIL_RECIPIENT_DIRECTORY,
  EMAIL_SENDER,
  EMAIL_USAGE,
  EmailDeliveryStorePort,
  EmailRecipientDirectoryPort,
  EmailSenderPort,
  EmailUsagePort,
} from "./application/ports/email.ports";
import { NotificationsMaintenanceRunner } from "./application/services/notifications-maintenance.runner";
import { PurgeOldNotifications } from "./application/use-cases/purge-old-notifications";
import { emailDailyLimitFromEnvironment } from "./domain/email-health";
import { PrismaEmailDeliveryStore } from "./infrastructure/prisma-email-delivery.store";
import { PrismaEmailUsage } from "./infrastructure/prisma-email-usage";
import { BusinessEventsDispatcherRunner } from "./application/services/business-events-dispatcher.runner";
import { DispatchBusinessEvents } from "./application/use-cases/dispatch-business-events";
import { DeliverEmailNotifications } from "./application/use-cases/deliver-email-notifications";
import { DeliverPushNotifications } from "./application/use-cases/deliver-push-notifications";
import { ListInbox, MarkInboxRead } from "./application/use-cases/manage-inbox";
import { GetNotificationPreferences, RegisterPushSubscription, RemovePushSubscription, UpdateNotificationPreference } from "./application/use-cases/manage-push";
import { BrevoEmailSender } from "./infrastructure/brevo-email.sender";
import { PrismaEmailRecipientDirectory } from "./infrastructure/prisma-email-recipient.directory";
import { PrismaNotificationPreferenceStore } from "./infrastructure/prisma-notification-preference.store";
import { PrismaPushSubscriptionStore } from "./infrastructure/prisma-push-subscription.store";
import { PrismaNotificationStore } from "./infrastructure/prisma-notification.store";
import { PrismaOutboxReader } from "./infrastructure/prisma-outbox.reader";
import { PrismaRecipientDirectory } from "./infrastructure/prisma-recipient.directory";
import { SocketNotificationRealtime } from "./infrastructure/socket-notification.realtime";
import { WebPushSender } from "./infrastructure/web-push.sender";
import { NotificationsController } from "./presentation/notifications.controller";

@Module({
  /* Solo por el gateway de socket, para la sala personal de cada usuario. */
  imports: [RechargesModule],
  controllers: [NotificationsController],
  providers: [
    { provide: OUTBOX_READER, useClass: PrismaOutboxReader },
    { provide: RECIPIENT_DIRECTORY, useClass: PrismaRecipientDirectory },
    { provide: NOTIFICATION_STORE, useClass: PrismaNotificationStore },
    { provide: NOTIFICATION_REALTIME, useClass: SocketNotificationRealtime },
    { provide: PUSH_SENDER, useClass: WebPushSender },
    { provide: PUSH_SUBSCRIPTION_STORE, useClass: PrismaPushSubscriptionStore },
    { provide: NOTIFICATION_PREFERENCE_STORE, useClass: PrismaNotificationPreferenceStore },
    {
      provide: DeliverPushNotifications,
      inject: [PUSH_SENDER, PUSH_SUBSCRIPTION_STORE, NOTIFICATION_PREFERENCE_STORE, NOTIFICATION_STORE],
      useFactory: (sender: PushSenderPort, subscriptions: PushSubscriptionStorePort, preferences: NotificationPreferenceStorePort, store: NotificationStorePort) =>
        new DeliverPushNotifications(sender, subscriptions, preferences, store),
    },
    { provide: EMAIL_SENDER, useFactory: () => new BrevoEmailSender() },
    { provide: EMAIL_RECIPIENT_DIRECTORY, useClass: PrismaEmailRecipientDirectory },
    { provide: EMAIL_DELIVERY_STORE, useClass: PrismaEmailDeliveryStore },
    { provide: EMAIL_USAGE, useClass: PrismaEmailUsage },
    {
      provide: DeliverEmailNotifications,
      inject: [EMAIL_SENDER, EMAIL_RECIPIENT_DIRECTORY, NOTIFICATION_PREFERENCE_STORE, EMAIL_DELIVERY_STORE, EMAIL_USAGE],
      useFactory: (sender: EmailSenderPort, directory: EmailRecipientDirectoryPort, preferences: NotificationPreferenceStorePort, deliveries: EmailDeliveryStorePort, usage: EmailUsagePort) =>
        new DeliverEmailNotifications(sender, directory, preferences, deliveries, usage, {
          appUrl: process.env.FRONTEND_ORIGIN?.trim() || null,
          dailyLimit: emailDailyLimitFromEnvironment(),
        }),
    },
    { provide: PurgeOldNotifications, inject: [NOTIFICATION_STORE], useFactory: (store: NotificationStorePort) => new PurgeOldNotifications(store) },
    NotificationsMaintenanceRunner,
    {
      provide: DispatchBusinessEvents,
      inject: [OUTBOX_READER, RECIPIENT_DIRECTORY, NOTIFICATION_STORE, NOTIFICATION_REALTIME, DeliverPushNotifications, DeliverEmailNotifications],
      /* Canales de entrega además de la bandeja: uno nuevo se añade aquí. */
      useFactory: (outbox: OutboxReaderPort, directory: RecipientDirectoryPort, store: NotificationStorePort, realtime: NotificationRealtimePort, push: DeliverPushNotifications, email: DeliverEmailNotifications) =>
        new DispatchBusinessEvents(outbox, directory, store, realtime, [push, email]),
    },
    { provide: ListInbox, inject: [NOTIFICATION_STORE], useFactory: (store: NotificationStorePort) => new ListInbox(store) },
    {
      provide: MarkInboxRead,
      inject: [NOTIFICATION_STORE, NOTIFICATION_REALTIME],
      useFactory: (store: NotificationStorePort, realtime: NotificationRealtimePort) => new MarkInboxRead(store, realtime),
    },
    {
      provide: GetNotificationPreferences,
      inject: [NOTIFICATION_PREFERENCE_STORE, PUSH_SENDER, EMAIL_SENDER],
      useFactory: (preferences: NotificationPreferenceStorePort, sender: PushSenderPort, email: EmailSenderPort) => new GetNotificationPreferences(preferences, sender, email),
    },
    { provide: UpdateNotificationPreference, inject: [NOTIFICATION_PREFERENCE_STORE], useFactory: (preferences: NotificationPreferenceStorePort) => new UpdateNotificationPreference(preferences) },
    {
      provide: RegisterPushSubscription,
      inject: [PUSH_SUBSCRIPTION_STORE, PUSH_SENDER],
      useFactory: (subscriptions: PushSubscriptionStorePort, sender: PushSenderPort) => new RegisterPushSubscription(subscriptions, sender),
    },
    { provide: RemovePushSubscription, inject: [PUSH_SUBSCRIPTION_STORE], useFactory: (subscriptions: PushSubscriptionStorePort) => new RemovePushSubscription(subscriptions) },
    BusinessEventsDispatcherRunner,
  ],
})
export class NotificationsModule {}
