import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { seedBackendData } from "./seed-data";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    await seedBackendData(this);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
