import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseFilters } from "@nestjs/common";
import { ApplicationError } from "../../../common/errors/application.error";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { ApplicationErrorFilter } from "../../recharges/presentation/application-error.filter";
import { ListInbox, MarkInboxRead } from "../application/use-cases/manage-inbox";
import { ListNotificationsQueryDto, MarkNotificationsReadDto } from "./dto/notifications.dto";

/* Todos los roles tienen bandeja. El destinatario sale siempre del token. */
@Controller("notifications")
@UseFilters(ApplicationErrorFilter)
@Roles("CLIENT", "GESTOR", "ADMIN")
export class NotificationsController {
  constructor(private readonly listInbox: ListInbox, private readonly markRead: MarkInboxRead) {}

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
}
