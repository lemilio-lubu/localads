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
import { BusinessEventsDispatcherRunner } from "./application/services/business-events-dispatcher.runner";
import { DispatchBusinessEvents } from "./application/use-cases/dispatch-business-events";
import { ListInbox, MarkInboxRead } from "./application/use-cases/manage-inbox";
import { PrismaNotificationStore } from "./infrastructure/prisma-notification.store";
import { PrismaOutboxReader } from "./infrastructure/prisma-outbox.reader";
import { PrismaRecipientDirectory } from "./infrastructure/prisma-recipient.directory";
import { SocketNotificationRealtime } from "./infrastructure/socket-notification.realtime";
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
    {
      provide: DispatchBusinessEvents,
      inject: [OUTBOX_READER, RECIPIENT_DIRECTORY, NOTIFICATION_STORE, NOTIFICATION_REALTIME],
      useFactory: (outbox: OutboxReaderPort, directory: RecipientDirectoryPort, store: NotificationStorePort, realtime: NotificationRealtimePort) =>
        new DispatchBusinessEvents(outbox, directory, store, realtime),
    },
    { provide: ListInbox, inject: [NOTIFICATION_STORE], useFactory: (store: NotificationStorePort) => new ListInbox(store) },
    {
      provide: MarkInboxRead,
      inject: [NOTIFICATION_STORE, NOTIFICATION_REALTIME],
      useFactory: (store: NotificationStorePort, realtime: NotificationRealtimePort) => new MarkInboxRead(store, realtime),
    },
    BusinessEventsDispatcherRunner,
  ],
})
export class NotificationsModule {}
