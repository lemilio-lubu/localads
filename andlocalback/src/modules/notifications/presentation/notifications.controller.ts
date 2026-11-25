import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Post, Put, Query, UseFilters } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApplicationError } from "../../../common/errors/application.error";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { ApplicationErrorFilter } from "../../recharges/presentation/application-error.filter";
import { ListInbox, MarkInboxRead } from "../application/use-cases/manage-inbox";
import { GetNotificationPreferences, RegisterPushSubscription, RemovePushSubscription, UpdateNotificationPreference } from "../application/use-cases/manage-push";
import {
  ListNotificationsQueryDto,
  MarkNotificationsReadDto,
  RegisterPushSubscriptionDto,
  RemovePushSubscriptionDto,
  UpdateNotificationPreferenceDto,
} from "./dto/notifications.dto";

/* Cada usuario registra pocos dispositivos: más que esto por minuto no es uso normal. */
const pushRateLimit = { default: { ttl: 60_000, limit: 20 } };

/* Todos los roles tienen bandeja. El destinatario sale siempre del token. */
@Controller("notifications")
@UseFilters(ApplicationErrorFilter)
@Roles("CLIENT", "GESTOR", "ADMIN")
export class NotificationsController {
  constructor(
    private readonly listInbox: ListInbox,
    private readonly markRead: MarkInboxRead,
    private readonly getPreferences: GetNotificationPreferences,
    private readonly updatePreference: UpdateNotificationPreference,
    private readonly registerPush: RegisterPushSubscription,
    private readonly removePush: RemovePushSubscription,
  ) {}

  @Get()
  list(@Query() query: ListNotificationsQueryDto, @CurrentUser() user: AuthPrincipal) {
    return this.listInbox.execute({ userId: user.userId, cursor: query.cursor, limit: query.limit, unreadOnly: query.unreadOnly });
  }

  @Post("read")
  @HttpCode(HttpStatus.OK)
  read(@Body() body: MarkNotificationsReadDto, @CurrentUser() user: AuthPrincipal) {
    if (Boolean(body.all) === Boolean(body.ids)) throw new ApplicationError("NOTIFICATION_IDS_INVALID", "Indica los avisos o todos, no ambos", 400);
    return this.markRead.execute({ userId: user.userId, ids: body.all ? "ALL" : body.ids ?? [] });
  }

  /* Los grupos que puede apagar su rol, y si el push está disponible (con la clave pública). */
  @Get("preferences")
  preferences(@CurrentUser() user: AuthPrincipal) {
    return this.getPreferences.execute({ userId: user.userId, role: user.role });
  }

  @Put("preferences")
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPreference(@Body() body: UpdateNotificationPreferenceDto, @CurrentUser() user: AuthPrincipal) {
    await this.updatePreference.execute({ userId: user.userId, role: user.role, key: body.key, push: body.push });
  }

  @Post("push-subscriptions")
  @Throttle(pushRateLimit)
  @HttpCode(HttpStatus.NO_CONTENT)
  async subscribe(@Body() body: RegisterPushSubscriptionDto, @CurrentUser() user: AuthPrincipal, @Headers("user-agent") userAgent?: string) {
    await this.registerPush.execute({ userId: user.userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: userAgent ?? null });
  }

  @Delete("push-subscriptions")
  @Throttle(pushRateLimit)
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsubscribe(@Body() body: RemovePushSubscriptionDto, @CurrentUser() user: AuthPrincipal) {
    await this.removePush.execute({ userId: user.userId, endpoint: body.endpoint });
  }
}
