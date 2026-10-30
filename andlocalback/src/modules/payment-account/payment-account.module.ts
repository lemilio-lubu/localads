import { Module } from "@nestjs/common";
import { PAYMENT_ACCOUNT_REPOSITORY, PaymentAccountRepository } from "./application/ports/payment-account.repository";
import { GetPaymentAccount } from "./application/use-cases/get-payment-account";
import { ListPaymentAccountHistory } from "./application/use-cases/list-payment-account-history";
import { UpdatePaymentAccount } from "./application/use-cases/update-payment-account";
import { PrismaPaymentAccountRepository } from "./infrastructure/prisma-payment-account.repository";
import { PaymentAccountController } from "./presentation/payment-account.controller";

@Module({
  controllers: [PaymentAccountController],
  providers: [
    PrismaPaymentAccountRepository,
    { provide: PAYMENT_ACCOUNT_REPOSITORY, useExisting: PrismaPaymentAccountRepository },
    { provide: GetPaymentAccount, inject: [PAYMENT_ACCOUNT_REPOSITORY], useFactory: (accounts: PaymentAccountRepository) => new GetPaymentAccount(accounts) },
    { provide: UpdatePaymentAccount, inject: [PAYMENT_ACCOUNT_REPOSITORY], useFactory: (accounts: PaymentAccountRepository) => new UpdatePaymentAccount(accounts) },
    { provide: ListPaymentAccountHistory, inject: [PAYMENT_ACCOUNT_REPOSITORY], useFactory: (accounts: PaymentAccountRepository) => new ListPaymentAccountHistory(accounts) },
  ],
})
export class PaymentAccountModule {}
