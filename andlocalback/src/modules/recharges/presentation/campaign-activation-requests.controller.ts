import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
} from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import { TransactionsGateway } from "./transactions.gateway";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { ApproveCampaignActivation } from "../application/use-cases/approve-campaign-activation";
import { ListClientCampaignActivations } from "../application/use-cases/list-client-campaign-activations";
import { ListPendingCampaignActivations } from "../application/use-cases/list-pending-campaign-activations";
import { RejectCampaignActivation } from "../application/use-cases/reject-campaign-activation";
import { RequestCampaignActivation } from "../application/use-cases/request-campaign-activation";
import { StartCampaignActivationReview } from "../application/use-cases/start-campaign-activation-review";
import { ApplicationErrorFilter } from "./application-error.filter";
import { scopeFor } from "../../../common/access/manager-scope";
import { AssertManagerScope } from "../application/ports/manager-scope.ports";
import {
  CampaignActivationRejectionDto,
  CampaignActivationReviewDecisionDto,
  CreateCampaignActivationRequestDto,
  ListAdminCampaignActivationRequestsQueryDto,
  ListOwnCampaignActivationRequestsQueryDto,
} from "./dto/campaign-activation-request.dto";

@Controller("campaign-activation-requests")
@UseFilters(ApplicationErrorFilter)
export class CampaignActivationRequestsController {
  constructor(
    private readonly requestActivation: RequestCampaignActivation,
    private readonly listClientActivations: ListClientCampaignActivations,
    private readonly realtime: TransactionsGateway,
  ) {}

  @Post()
  @Roles("CLIENT")
  async request(@Body() body: CreateCampaignActivationRequestDto, @CurrentUser() user?: AuthPrincipal) {
    const result = await this.requestActivation.execute({
      accountId: ownAccount(user, body.accountId),
      platform: body.platform,
      requesterName: body.requesterName,
      externalAccountId: body.externalAccountId,
      phone: body.phone,
      firstRechargeAmount: Number(body.firstRechargeAmount),
    });
    this.realtime?.publishPlatforms(result.clientId);
    return result;
  }

  @Get()
  @Roles("CLIENT")
  listOwn(@Query() query: ListOwnCampaignActivationRequestsQueryDto, @CurrentUser() user?: AuthPrincipal) {
    return this.listClientActivations.execute({ accountId: ownAccount(user, query.accountId) });
  }
}

/* Admin y gestor comparten pantalla y decisiones; lo que separa a uno de otro
   es la cartera, comprobada antes de cada decision. */
@Controller("admin/campaign-activation-requests")
@UseFilters(ApplicationErrorFilter)
@Roles("ADMIN", "GESTOR")
export class AdminCampaignActivationRequestsController {
  constructor(
    private readonly listPendingActivations: ListPendingCampaignActivations,
    private readonly startReview: StartCampaignActivationReview,
    private readonly approveActivation: ApproveCampaignActivation,
    private readonly rejectActivation: RejectCampaignActivation,
    private readonly realtime: TransactionsGateway,
    private readonly scope: AssertManagerScope,
  ) {}

  @Get()
  list(@Query() query: ListAdminCampaignActivationRequestsQueryDto, @CurrentUser() user: AuthPrincipal) {
    return this.listPendingActivations.execute({ status: query.status, managerId: scopeFor(user).managerId });
  }

  @Patch(":id/review")
  async review(@Param("id") requestId: string, @Body() body: CampaignActivationReviewDecisionDto, @CurrentUser() user?: AuthPrincipal) {
    if (user) await this.scope.activationRequest(requestId, scopeFor(user));
    const result = await this.startReview.execute({ requestId, administratorId: user?.userId ?? body.administratorId });
    this.realtime?.publishPlatforms(result.clientId);
    return result;
  }

  @Patch(":id/approve")
  async approve(@Param("id") requestId: string, @Body() body: CampaignActivationReviewDecisionDto, @CurrentUser() user?: AuthPrincipal) {
    if (user) await this.scope.activationRequest(requestId, scopeFor(user));
    const result = await this.approveActivation.execute({ requestId, administratorId: user?.userId ?? body.administratorId });
    this.realtime?.publishPlatforms(result.clientId);
    return result;
  }

  @Patch(":id/reject")
  async reject(@Param("id") requestId: string, @Body() body: CampaignActivationRejectionDto, @CurrentUser() user?: AuthPrincipal) {
    if (user) await this.scope.activationRequest(requestId, scopeFor(user));
    const result = await this.rejectActivation.execute({
      requestId,
      administratorId: user?.userId ?? body.administratorId,
      reason: body.reason,
    });
    this.realtime?.publishPlatforms(result.clientId);
    return result;
  }
}

function ownAccount(user: AuthPrincipal | undefined, requested: string): string {
  if (!user) return requested; // Unit tests call controllers without the global guard.
  if (!user.accountId) throw new ForbiddenException("El usuario no está vinculado a una cuenta");
  return user.accountId;
}
