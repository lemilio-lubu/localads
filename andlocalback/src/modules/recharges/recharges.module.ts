import { Module } from "@nestjs/common";
import { ApprovePrepaidVerification } from "./application/use-cases/approve-prepaid-verification";
import { CreatePrepaidRecharge } from "./application/use-cases/create-prepaid-recharge";
import { CreatePostpaidRecharge } from "./application/use-cases/create-postpaid-recharge";
import { MoveRechargeToProcessing } from "./application/use-cases/move-recharge-to-processing";
import { RejectPrepaidVerification } from "./application/use-cases/reject-prepaid-verification";
import { ReplacePrepaidReceipt } from "./application/use-cases/replace-prepaid-receipt";
import {
  MULTI_RECHARGE_PERSISTENCE,
  MultiRechargePersistencePort,
} from "./application/ports/multi-recharge.ports";
import {
  ACCOUNT_REPOSITORY, AccountRepository, ID_GENERATOR, IdGenerator, OCR_PROCESSOR, OcrProcessor,
  RECEIPT_PROCESSOR, RECHARGE_REPOSITORY, ReceiptProcessor, RechargeRepository,
  TRANSACTION_QUERY_REPOSITORY, TransactionQueryRepository, TRANSACTION_REALTIME_PUBLISHER, TransactionRealtimePublisher,
} from "./application/ports/recharge.ports";
import { ListAccountTransactions } from "./application/use-cases/list-account-transactions";
import { RequestPrepaidTransaction } from "./application/use-cases/request-prepaid-transaction";
import { TransactionReceiptOcrDispatcher } from "./application/services/transaction-receipt-ocr-dispatcher";
import { OverduePaymentsRunner } from "./application/services/overdue-payments-runner";
import { MarkOverduePayments } from "./application/use-cases/mark-overdue-payments";
import { RequestPostpaidTransaction } from "./application/use-cases/request-postpaid-transaction";
import {
  POSTPAID_TRANSACTION_PERSISTENCE,
  PostpaidTransactionPersistencePort,
} from "./application/ports/postpaid-transaction.ports";
import { ApproveTransactionVerification } from "./application/use-cases/approve-transaction-verification";
import { ProcessTransactionReceiptOcr } from "./application/use-cases/process-transaction-receipt-ocr";
import { RejectTransactionVerification } from "./application/use-cases/reject-transaction-verification";
import { MarkTransactionVerificationUnderReview } from "./application/use-cases/mark-transaction-verification-under-review";
import { UploadPaymentReceipt } from "./application/use-cases/upload-payment-receipt";
import { StartTransactionRecharge } from "./application/use-cases/start-transaction-recharge";
import { CompleteTransactionDetail } from "./application/use-cases/complete-transaction-detail";
import { CompleteTransaction } from "./application/use-cases/complete-transaction";
import { ApproveCampaignActivation } from "./application/use-cases/approve-campaign-activation";
import { ListClientCampaignActivations } from "./application/use-cases/list-client-campaign-activations";
import { ListPendingCampaignActivations } from "./application/use-cases/list-pending-campaign-activations";
import { RejectCampaignActivation } from "./application/use-cases/reject-campaign-activation";
import { RequestCampaignActivation } from "./application/use-cases/request-campaign-activation";
import { StartCampaignActivationReview } from "./application/use-cases/start-campaign-activation-review";
import { GetAdminTransactionDetail } from "./application/use-cases/get-admin-transaction-detail";
import { GetMyPautas } from "./application/use-cases/get-my-pautas";
import { GetMyTransactionDetail } from "./application/use-cases/get-my-transaction-detail";
import { GetMyTransactions } from "./application/use-cases/get-my-transactions";
import { GetWalletOverview } from "./application/use-cases/get-wallet-overview";
import { ListAdminTransactions } from "./application/use-cases/list-admin-transactions";
import { ListVerifications } from "./application/use-cases/list-verifications";
import { PHASE7_QUERY_PORT, Phase7QueryPort } from "./application/ports/phase7-query.ports";
import {
  CAMPAIGN_ACTIVATION_PERSISTENCE,
  CampaignActivationPersistencePort,
} from "./application/ports/campaign-activation.ports";
import {
  TRANSACTION_EXECUTION_PERSISTENCE,
  TransactionExecutionPersistencePort,
} from "./application/ports/transaction-execution.ports";
import {
  PAYMENT_RECEIPT_PERSISTENCE,
  PaymentReceiptPersistencePort,
  TRANSACTION_RECEIPT_OCR,
  TRANSACTION_VERIFICATION_PERSISTENCE,
  TransactionReceiptOcrPort,
  TransactionVerificationPersistencePort,
  VERIFICATION_REALTIME_PUBLISHER,
  VerificationRealtimePublisher,
} from "./application/ports/transaction-verification.ports";
import { PrismaAccountRepository } from "./infrastructure/persistence/prisma-account.repository";
import { PrismaMultiRechargeRepository } from "./infrastructure/persistence/prisma-multi-recharge.repository";
import { PrismaPostpaidTransactionRepository } from "./infrastructure/persistence/prisma-postpaid-transaction.repository";
import { PrismaRechargeRepository } from "./infrastructure/persistence/prisma-recharge.repository";
import { PrismaTransactionVerificationRepository } from "./infrastructure/persistence/prisma-transaction-verification.repository";
import { PrismaTransactionExecutionRepository } from "./infrastructure/persistence/prisma-transaction-execution.repository";
import { PrismaCampaignActivationRepository } from "./infrastructure/persistence/prisma-campaign-activation.repository";
import { PrismaPhase7QueryRepository } from "./infrastructure/persistence/prisma-phase7-query.repository";
import { CryptoIdGenerator } from "./infrastructure/services/crypto-id-generator";
import { LocalReceiptProcessor } from "./infrastructure/services/local-receipt-processor";
import { TesseractOcrProcessor } from "./infrastructure/services/tesseract-ocr-processor";
import { LocalTransactionReceiptOcr } from "./infrastructure/services/local-transaction-receipt-ocr";
import { PostpaidRechargesController } from "./presentation/postpaid-recharges.controller";
import { PrepaidRechargesController } from "./presentation/recharges.controller";
import { RechargeWorkflowController } from "./presentation/recharge-workflow.controller";
import { TransactionsController } from "./presentation/transactions.controller";
import { TransactionsGateway } from "./presentation/transactions.gateway";
import { TransactionVerificationsController } from "./presentation/transaction-verifications.controller";
import { TransactionExecutionController } from "./presentation/transaction-execution.controller";
import {
  AdminCampaignActivationRequestsController,
  CampaignActivationRequestsController,
} from "./presentation/campaign-activation-requests.controller";
import {
  AdminRechargeQueriesController,
  MyRechargeQueriesController,
} from "./presentation/phase7-query.controller";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  exports: [TransactionsGateway],
  controllers: [PrepaidRechargesController, PostpaidRechargesController, RechargeWorkflowController, TransactionsController, TransactionVerificationsController, TransactionExecutionController, CampaignActivationRequestsController, AdminCampaignActivationRequestsController, MyRechargeQueriesController, AdminRechargeQueriesController],
  providers: [
    PrismaAccountRepository,
    PrismaMultiRechargeRepository,
    PrismaPostpaidTransactionRepository,
    PrismaRechargeRepository,
    PrismaTransactionVerificationRepository,
    PrismaTransactionExecutionRepository,
    PrismaCampaignActivationRepository,
    PrismaPhase7QueryRepository,
    TransactionsGateway,
    TransactionReceiptOcrDispatcher,
    OverduePaymentsRunner,
    { provide: ACCOUNT_REPOSITORY, useExisting: PrismaAccountRepository },
    { provide: MULTI_RECHARGE_PERSISTENCE, useExisting: PrismaMultiRechargeRepository },
    { provide: POSTPAID_TRANSACTION_PERSISTENCE, useExisting: PrismaPostpaidTransactionRepository },
    { provide: RECHARGE_REPOSITORY, useExisting: PrismaRechargeRepository },
    { provide: TRANSACTION_VERIFICATION_PERSISTENCE, useExisting: PrismaTransactionVerificationRepository },
    { provide: PAYMENT_RECEIPT_PERSISTENCE, useExisting: PrismaTransactionVerificationRepository },
    { provide: VERIFICATION_REALTIME_PUBLISHER, useExisting: TransactionsGateway },
    { provide: TRANSACTION_EXECUTION_PERSISTENCE, useExisting: PrismaTransactionExecutionRepository },
    { provide: CAMPAIGN_ACTIVATION_PERSISTENCE, useExisting: PrismaCampaignActivationRepository },
    { provide: PHASE7_QUERY_PORT, useExisting: PrismaPhase7QueryRepository },
    { provide: TRANSACTION_QUERY_REPOSITORY, useExisting: PrismaRechargeRepository },
    { provide: TRANSACTION_REALTIME_PUBLISHER, useExisting: TransactionsGateway },
    { provide: RECEIPT_PROCESSOR, useClass: LocalReceiptProcessor },
    { provide: OCR_PROCESSOR, useClass: TesseractOcrProcessor },
    {
      provide: TRANSACTION_RECEIPT_OCR,
      inject: [OCR_PROCESSOR],
      useFactory: (ocr: OcrProcessor) => new LocalTransactionReceiptOcr(ocr),
    },
    { provide: ID_GENERATOR, useClass: CryptoIdGenerator },
    {
      provide: RequestPrepaidTransaction,
      inject: [MULTI_RECHARGE_PERSISTENCE, RECEIPT_PROCESSOR, ID_GENERATOR],
      useFactory: (
        persistence: MultiRechargePersistencePort,
        processor: ReceiptProcessor,
        ids: IdGenerator,
      ) => new RequestPrepaidTransaction(persistence, processor, ids),
    },
    {
      provide: RequestPostpaidTransaction,
      inject: [POSTPAID_TRANSACTION_PERSISTENCE, ID_GENERATOR],
      useFactory: (persistence: PostpaidTransactionPersistencePort, ids: IdGenerator) =>
        new RequestPostpaidTransaction(persistence, ids),
    },
    {
      provide: MarkOverduePayments,
      inject: [POSTPAID_TRANSACTION_PERSISTENCE],
      useFactory: (persistence: PostpaidTransactionPersistencePort) =>
        new MarkOverduePayments(persistence),
    },
    {
      provide: ProcessTransactionReceiptOcr,
      inject: [TRANSACTION_VERIFICATION_PERSISTENCE, TRANSACTION_RECEIPT_OCR, ID_GENERATOR, VERIFICATION_REALTIME_PUBLISHER],
      useFactory: (
        persistence: TransactionVerificationPersistencePort,
        ocr: TransactionReceiptOcrPort,
        ids: IdGenerator,
        realtime: VerificationRealtimePublisher,
      ) => new ProcessTransactionReceiptOcr(persistence, ocr, ids, undefined, undefined, realtime),
    },
    {
      provide: ApproveTransactionVerification,
      inject: [TRANSACTION_VERIFICATION_PERSISTENCE, VERIFICATION_REALTIME_PUBLISHER],
      useFactory: (persistence: TransactionVerificationPersistencePort, realtime: VerificationRealtimePublisher) =>
        new ApproveTransactionVerification(persistence, undefined, realtime),
    },
    {
      provide: RejectTransactionVerification,
      inject: [TRANSACTION_VERIFICATION_PERSISTENCE, VERIFICATION_REALTIME_PUBLISHER],
      useFactory: (persistence: TransactionVerificationPersistencePort, realtime: VerificationRealtimePublisher) =>
        new RejectTransactionVerification(persistence, undefined, realtime),
    },
    {
      provide: MarkTransactionVerificationUnderReview,
      inject: [TRANSACTION_VERIFICATION_PERSISTENCE, VERIFICATION_REALTIME_PUBLISHER],
      useFactory: (persistence: TransactionVerificationPersistencePort, realtime: VerificationRealtimePublisher) =>
        new MarkTransactionVerificationUnderReview(persistence, undefined, realtime),
    },
    {
      provide: UploadPaymentReceipt,
      inject: [PAYMENT_RECEIPT_PERSISTENCE, RECEIPT_PROCESSOR],
      useFactory: (persistence: PaymentReceiptPersistencePort, processor: ReceiptProcessor) =>
        new UploadPaymentReceipt(persistence, processor),
    },
    {
      provide: StartTransactionRecharge,
      inject: [TRANSACTION_EXECUTION_PERSISTENCE],
      useFactory: (persistence: TransactionExecutionPersistencePort) =>
        new StartTransactionRecharge(persistence),
    },
    {
      provide: CompleteTransactionDetail,
      inject: [TRANSACTION_EXECUTION_PERSISTENCE],
      useFactory: (persistence: TransactionExecutionPersistencePort) =>
        new CompleteTransactionDetail(persistence),
    },
    {
      provide: CompleteTransaction,
      inject: [TRANSACTION_EXECUTION_PERSISTENCE, ID_GENERATOR],
      useFactory: (persistence: TransactionExecutionPersistencePort, ids: IdGenerator) =>
        new CompleteTransaction(persistence, ids),
    },
    {
      provide: RequestCampaignActivation,
      inject: [CAMPAIGN_ACTIVATION_PERSISTENCE, ID_GENERATOR],
      useFactory: (persistence: CampaignActivationPersistencePort, ids: IdGenerator) =>
        new RequestCampaignActivation(persistence, ids),
    },
    {
      provide: ListClientCampaignActivations,
      inject: [CAMPAIGN_ACTIVATION_PERSISTENCE],
      useFactory: (persistence: CampaignActivationPersistencePort) =>
        new ListClientCampaignActivations(persistence),
    },
    {
      provide: ListPendingCampaignActivations,
      inject: [CAMPAIGN_ACTIVATION_PERSISTENCE],
      useFactory: (persistence: CampaignActivationPersistencePort) =>
        new ListPendingCampaignActivations(persistence),
    },
    {
      provide: StartCampaignActivationReview,
      inject: [CAMPAIGN_ACTIVATION_PERSISTENCE],
      useFactory: (persistence: CampaignActivationPersistencePort) =>
        new StartCampaignActivationReview(persistence),
    },
    {
      provide: ApproveCampaignActivation,
      inject: [CAMPAIGN_ACTIVATION_PERSISTENCE, ID_GENERATOR],
      useFactory: (persistence: CampaignActivationPersistencePort, ids: IdGenerator) =>
        new ApproveCampaignActivation(persistence, ids),
    },
    {
      provide: RejectCampaignActivation,
      inject: [CAMPAIGN_ACTIVATION_PERSISTENCE],
      useFactory: (persistence: CampaignActivationPersistencePort) =>
        new RejectCampaignActivation(persistence),
    },
    ...[
      GetMyPautas,
      GetWalletOverview,
      GetMyTransactions,
      GetMyTransactionDetail,
      ListAdminTransactions,
      GetAdminTransactionDetail,
      ListVerifications,
    ].map((provide) => ({
      provide,
      inject: [PHASE7_QUERY_PORT],
      useFactory: (queries: Phase7QueryPort) => new provide(queries),
    })),
    {
      provide: CreatePrepaidRecharge,
      inject: [ACCOUNT_REPOSITORY, RECHARGE_REPOSITORY, RECEIPT_PROCESSOR, OCR_PROCESSOR, ID_GENERATOR, TRANSACTION_REALTIME_PUBLISHER],
      useFactory: (accounts: AccountRepository, recharges: RechargeRepository, processor: ReceiptProcessor, ocr: OcrProcessor, ids: IdGenerator, realtime: TransactionRealtimePublisher) =>
        new CreatePrepaidRecharge(accounts, recharges, processor, ocr, ids, realtime),
    },
    {
      provide: CreatePostpaidRecharge,
      inject: [ACCOUNT_REPOSITORY, RECHARGE_REPOSITORY, ID_GENERATOR, TRANSACTION_REALTIME_PUBLISHER],
      useFactory: (accounts: AccountRepository, recharges: RechargeRepository, ids: IdGenerator, realtime: TransactionRealtimePublisher) =>
        new CreatePostpaidRecharge(accounts, recharges, ids, realtime),
    },
    {
      provide: MoveRechargeToProcessing,
      inject: [RECHARGE_REPOSITORY, TRANSACTION_REALTIME_PUBLISHER],
      useFactory: (recharges: RechargeRepository, realtime: TransactionRealtimePublisher) => new MoveRechargeToProcessing(recharges, realtime),
    },
    {
      provide: ApprovePrepaidVerification,
      inject: [RECHARGE_REPOSITORY, TRANSACTION_REALTIME_PUBLISHER],
      useFactory: (recharges: RechargeRepository, realtime: TransactionRealtimePublisher) => new ApprovePrepaidVerification(recharges, realtime),
    },
    {
      provide: RejectPrepaidVerification,
      inject: [RECHARGE_REPOSITORY, TRANSACTION_REALTIME_PUBLISHER],
      useFactory: (recharges: RechargeRepository, realtime: TransactionRealtimePublisher) => new RejectPrepaidVerification(recharges, realtime),
    },
    {
      provide: ReplacePrepaidReceipt,
      inject: [RECHARGE_REPOSITORY, RECEIPT_PROCESSOR, OCR_PROCESSOR, TRANSACTION_REALTIME_PUBLISHER],
      useFactory: (recharges: RechargeRepository, processor: ReceiptProcessor, ocr: OcrProcessor, realtime: TransactionRealtimePublisher) => new ReplacePrepaidReceipt(recharges, processor, ocr, realtime),
    },
    {
      provide: ListAccountTransactions,
      inject: [ACCOUNT_REPOSITORY, TRANSACTION_QUERY_REPOSITORY],
      useFactory: (accounts: AccountRepository, transactions: TransactionQueryRepository) => new ListAccountTransactions(accounts, transactions),
    },
  ],
})
export class RechargesModule {}
