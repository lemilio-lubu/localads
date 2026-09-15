import { ApplicationError } from "../../../../common/errors/application.error";
import { Payment } from "../../domain/entities/payment";
import { Pauta } from "../../domain/entities/pauta";
import { Transaction } from "../../domain/entities/transaction";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import {
  AccountStatus,
  AccountType,
  AdvertisingPlatform,
  ClientStatus,
  ReceiptUpload,
} from "../../domain/recharge.types";
import { PautaStatus } from "../../domain/model/domain-status";
import { IdGenerator, ReceiptProcessor } from "../ports/recharge.ports";
import {
  MultiRechargePersistencePort,
  PrepaidTransactionView,
} from "../ports/multi-recharge.ports";

export type RequestPrepaidTransactionCommand = Readonly<{
  /** Future authenticated principal. Omitted only by the temporary unauthenticated HTTP adapter. */
  clientId?: string;
  accountId: string;
  idempotencyKey: string;
  details: readonly Readonly<{
    pautaId?: string;
    platform: AdvertisingPlatform;
    amount: number;
  }>[];
  receipt?: ReceiptUpload;
}>;

export class RequestPrepaidTransaction {
  constructor(
    private readonly persistence: MultiRechargePersistencePort,
    private readonly receiptProcessor: ReceiptProcessor,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: RequestPrepaidTransactionCommand): Promise<PrepaidTransactionView> {
    this.assertRequiredText(command.accountId, "ACCOUNT_REQUIRED", "La cuenta es obligatoria");
    this.assertRequiredText(command.idempotencyKey, "IDEMPOTENCY_KEY_REQUIRED", "La clave de idempotencia es obligatoria");
    if (command.clientId !== undefined) {
      this.assertRequiredText(command.clientId, "CLIENT_REQUIRED", "El cliente no puede estar vacio");
    }

    const context = await this.persistence.loadContext(command.accountId);
    if (!context.account) throw new ApplicationError("ACCOUNT_NOT_FOUND", "La cuenta no existe", 404);
    if (!context.client) throw new ApplicationError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    if (context.account.clientId !== context.client.id) {
      throw new ApplicationError("INVALID_ACCOUNT_CONTEXT", "La cuenta no coincide con su cliente", 409);
    }
    if (command.clientId !== undefined && context.account.clientId !== command.clientId) {
      throw new ApplicationError("ACCOUNT_NOT_OWNED", "La cuenta no pertenece al cliente", 409);
    }
    const clientId = context.client.id;
    const existing = await this.persistence.findByIdempotencyKey(clientId, command.idempotencyKey);
    if (existing) return existing;

    if (context.client.status !== ClientStatus.ACTIVE) {
      throw new ApplicationError("CLIENT_INACTIVE", "El cliente no esta activo", 409);
    }
    if (context.account.status !== AccountStatus.ACTIVE) {
      throw new ApplicationError("ACCOUNT_INACTIVE", "La cuenta no esta activa", 409);
    }
    if (context.account.type !== AccountType.PREPAID) {
      throw new ApplicationError("ACCOUNT_TYPE_MISMATCH", "La cuenta no es de tipo PREPAGO", 409);
    }
    if (!Array.isArray(command.details) || command.details.length === 0) {
      throw new ApplicationError("TRANSACTION_DETAILS_REQUIRED", "La recarga requiere al menos un detalle");
    }
    if (!command.receipt) {
      throw new ApplicationError("RECEIPT_REQUIRED", "La cuenta prepago requiere un comprobante");
    }

    const details = command.details.map((detail) => {
      if (!Object.values(AdvertisingPlatform).includes(detail.platform)) {
        throw new ApplicationError("UNSUPPORTED_PLATFORM", "La plataforma no esta soportada");
      }
      const amount = this.parsePositiveAmount(detail.amount);
      const pauta = this.resolvePauta(context.pautas, context.client!.id, detail.pautaId, detail.platform);
      return { pauta, amount };
    });

    const pautaIds = details.map(({ pauta }) => pauta.props.id);
    const platforms = details.map(({ pauta }) => pauta.props.platform);
    if (new Set(pautaIds).size !== pautaIds.length || new Set(platforms).size !== platforms.length) {
      throw new ApplicationError("DUPLICATE_PAUTA", "Una pauta o plataforma no puede repetirse en la misma transaccion");
    }

    const transactionId = this.ids.generate();
    const transaction = Transaction.create({
      id: transactionId,
      code: `TX-${transactionId}`,
      idempotencyKey: command.idempotencyKey,
      clientId,
      accountId: context.account.id,
      accountTypeSnapshot: context.account.type,
      details: details.map(({ pauta, amount }) => ({
        id: this.ids.generate(),
        pauta: {
          pautaId: pauta.props.id,
          platform: pauta.props.platform,
          externalAccountId: pauta.props.externalAccountId,
        },
        requestedAmount: amount,
      })),
    });
    const payment = Payment.create({
      id: this.ids.generate(),
      transactionId: transaction.id,
      accountTypeSnapshot: AccountType.PREPAID,
      expectedAmount: transaction.totals.totalAmount,
    });

    const receipt = await this.receiptProcessor.process(command.receipt);
    payment.sendToReview();
    transaction.markUnderReview();
    return this.persistence.savePrepaid({ transaction, payment, receipt });
  }

  private resolvePauta(
    pautas: readonly Pauta[],
    clientId: string,
    pautaId: string | undefined,
    platform: AdvertisingPlatform,
  ): Pauta {
    const pauta = pautaId
      ? pautas.find((candidate) => candidate.props.id === pautaId)
      : pautas.find((candidate) => candidate.props.platform === platform);
    if (!pauta || pauta.props.clientId !== clientId) {
      throw new ApplicationError("PAUTA_NOT_FOUND", `No existe una pauta ${platform} del cliente`, 404);
    }
    if (pauta.props.platform !== platform) {
      throw new ApplicationError("PAUTA_PLATFORM_MISMATCH", "La pauta no corresponde a la plataforma indicada", 409);
    }
    if (pauta.status !== PautaStatus.ACTIVE) {
      throw new ApplicationError("PAUTA_NOT_ACTIVE", `La pauta ${platform} no esta activa`, 409);
    }
    return pauta;
  }

  private parsePositiveAmount(amount: number): MonetaryAmount {
    try {
      const parsed = MonetaryAmount.fromMajorUnits(amount);
      if (parsed.isZero) throw new Error("zero");
      return parsed;
    } catch {
      throw new ApplicationError("INVALID_AMOUNT", "El monto de cada pauta debe ser mayor que cero y tener maximo dos decimales");
    }
  }

  private assertRequiredText(value: string, code: string, message: string): void {
    if (typeof value !== "string" || value.trim().length === 0) throw new ApplicationError(code, message);
  }

}
