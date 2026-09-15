import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service";
import { AccountRepository } from "../../application/ports/recharge.ports";
import { Account } from "../../domain/entities/account";
import { AccountStatus, AccountType, AdvertisingPlatform, CampaignStatus, ClientStatus } from "../../domain/recharge.types";

@Injectable()
export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const record = await this.prisma.account.findUnique({ where: { id }, include: { client: true, campaigns: true } });
    if (!record) return null;
    return new Account(
      record.id,
      { id: record.client.id, status: record.client.status as ClientStatus },
      record.status as AccountStatus,
      record.type as AccountType,
      record.campaigns.map((campaign) => ({
        id: campaign.id,
        platform: campaign.platform as AdvertisingPlatform,
        status: campaign.status as CampaignStatus,
      })),
      record.creditDays,
      record.creditLimit,
      record.creditUsed,
    );
  }

  async save(account: Account) {
    await this.prisma.account.update({ where: { id: account.id }, data: { creditUsed: account.creditUsed } });
  }
}
