const { PrismaClient } = require("@prisma/client");

// Read-only: discrepancies need an explicit decision; never guess prior removals.
const prisma = new PrismaClient();
async function main() {
  const clients = await prisma.client.findMany({ include: { pautas: true, accounts: { include: { campaigns: true } } } });
  const differences = [];
  for (const client of clients) {
    for (const account of client.accounts) {
      for (const platform of new Set([...client.pautas, ...account.campaigns].map((item) => item.platform))) {
        const pauta = client.pautas.find((item) => item.platform === platform);
        const campaign = account.campaigns.find((item) => item.platform === platform);
        const expected = pauta?.status === "ACTIVE" ? "ACTIVE" : "INACTIVE";
        if (!pauta || !campaign || campaign.status !== expected) differences.push({ clientId: client.id, accountId: account.id, platform, pautaStatus: pauta?.status ?? null, campaignStatus: campaign?.status ?? null });
      }
    }
  }
  console.log(JSON.stringify({ clients: clients.length, differences }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
