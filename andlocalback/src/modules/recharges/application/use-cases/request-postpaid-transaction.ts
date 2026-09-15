import { ApplicationError } from "../../../../common/errors/application.error";
import { Pauta } from "../../domain/entities/pauta";
import { Payment } from "../../domain/entities/payment";
import { Transaction } from "../../domain/entities/transaction";
import { PautaStatus } from "../../domain/model/domain-status";
import {
  AccountStatus,
  AccountType,
  AdvertisingPlatform,
  ClientStatus,
} from "../../domain/recharge.types";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import { IdGenerator } from "../ports/recharge.ports";
import {
  PostpaidTransactionPersistencePort,
  PostpaidTransactionView,
} from "../ports/postpaid-transaction.ports";

export type RequestPostpaidTransactionCommand = Readonly<{
  /** Future authenticated principal. Omitted only by the temporary unauthenticated HTTP adapter. */
  clientId?: string;
  accountId: string;
  idempotencyKey: string;
  details: readonly Readonly<{
    pautaId?: string;
    platform: AdvertisingPlatform;
    amount: number;
  }>[];
}>;

export class RequestPostpaidTransaction {
  constructor(
    private readonly persistence: PostpaidTransactionPersistencePort,
    private readonly ids: IdGenerator,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: RequestPostpaidTransactionCommand): Promise<PostpaidTransactionView> {
    this.assertRequiredText(command.accountId, "ACCOUNT_REQUIRED", "La cuenta es obligatoria");
    this.assertRequiredText(command.idempotencyKey, "IDEMPOTENCY_KEY_REQUIRED", "La clave de idempotencia es obligatoria");
    if (command.clientId !== undefined) {
      this.assertRequiredText(command.clientId, "CLIENT_REQUIRED", "El cliente no puede estar vacio");
    }

    const context = await this.persistence.loadPostpaidContext(command.accountId);
    if (!context.account) throw new ApplicationError("ACCOUNT_NOT_FOUND", "La cuenta no existe", 404);
    if (!context.client) throw new ApplicationError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    if (context.account.clientId !== context.client.id) {
      throw new ApplicationError("INVALID_ACCOUNT_CONTEXT", "La cuenta no coincide con su cliente", 409);
    }
    if (command.clientId !== undefined && context.account.clientId !== command.clientId) {
      throw new ApplicationError("ACCOUNT_NOT_OWNED", "La cuenta no pertenece al cliente", 409);
    }

    const clientId = context.client.id;
    const existing = await this.persistence.findPostpaidByIdempotencyKey(clientId, command.idempotencyKey);
    if (existing) return existing;

    if (context.client.status !== ClientStatus.ACTIVE) {
      throw new ApplicationError("CLIENT_INACTIVE", "El cliente no esta activo", 409);
    }
    if (context.account.status !== AccountStatus.ACTIVE) {
      throw new ApplicationError("ACCOUNT_INACTIVE", "La cuenta no esta activa", 409);
    }
    if (context.account.type !== AccountType.POSTPAID) {
      throw new ApplicationError("ACCOUNT_TYPE_MISMATCH", "La cuenta no es de tipo POSTPAGO", 409);
    }
    if (!Number.isSafeInteger(context.account.creditDays) || context.account.creditDays <= 0) {
      throw new ApplicationError("INVALID_CREDIT_DAYS", "La cuenta postpago requiere dias de credito mayores que cero", 409);
    }
    if (!Array.isArray(command.details) || command.details.length === 0) {
      throw new ApplicationError("TRANSACTION_DETAILS_REQUIRED", "La recarga requiere al menos un detalle");
    }

    const details = command.details.map((detail) => {
      if (!Object.values(AdvertisingPlatform).includes(detail.platform)) {
        throw new ApplicationError("UNSUPPORTED_PLATFORM", "La plataforma no esta soportada");
      }
      const amount = this.parsePositiveAmount(detail.amount);
      const pauta = this.resolvePauta(context.pautas, clientId, detail.pautaId, detail.platform);
      return { pauta, amount };
    });

    const pautaIds = details.map(({ pauta }) => pauta.props.id);
    const platforms = details.map(({ pauta }) => pauta.props.platform);
    if (new Set(pautaIds).size !== pautaIds.length || new Set(platforms).size !== platforms.length) {
      throw new ApplicationError("DUPLICATE_PAUTA", "Una pauta o plataforma no puede repetirse en la misma transaccion");
    }

    const createdAt = this.clock();
    const transactionId = this.ids.generate();
    const transaction = Transaction.create({
      id: transactionId,
      code: `TX-${transactionId}`,
      idempotencyKey: command.idempotencyKey,
      clientId,
      accountId: context.account.id,
      accountTypeSnapshot: AccountType.POSTPAID,
      createdAt,
      details: details.map(({ pauta, amount }) => ({
        id: this.ids.generate(),
        pauta: {
          pautaId: pauta.props.id,
          platform: pauta.props.platform,
          externalAccountId: pauta.props.externalAccountId,
        },
        requestedAmount: amount,
        createdAt,
      })),
    });

    this.assertCreditAvailable(
      context.account.creditLimit,
      context.account.creditUsed,
      transaction.totals.totalAmount,
    );

    const dueDate = new Date(createdAt.getTime());
    dueDate.setUTCDate(dueDate.getUTCDate() + context.account.creditDays);
    const payment = Payment.create({
      id: this.ids.generate(),
      transactionId: transaction.id,
      accountTypeSnapshot: AccountType.POSTPAID,
      expectedAmount: transaction.totals.totalAmount,
      createdAt,
      dueDate,
    });
    transaction.authorize();

    return this.persistence.savePostpaid({ transaction, payment });
  }

  private assertCreditAvailable(
    limit: MonetaryAmount,
    used: MonetaryAmount,
    requested: MonetaryAmount,
  ): void {
    if (used.cents > limit.cents || requested.cents > limit.cents - used.cents) {
      throw new ApplicationError("CREDIT_INSUFFICIENT", "La cuenta no tiene credito disponible suficiente", 409);
    }
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
