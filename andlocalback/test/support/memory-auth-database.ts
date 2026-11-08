import { vi } from "vitest";

/* Base en memoria con lo justo de Prisma que usa AuthService. */
export type Row = Record<string, unknown>;
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some((part) => matches(row, part));
    const value = row[key];
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      const c = condition as { lt?: number; has?: string };
      if ("lt" in c) return typeof value === "number" && value < (c.lt as number);
      if ("has" in c) return Array.isArray(value) && value.includes(c.has);
    }
    return value === condition;
  });
}
function apply(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value && typeof value === "object" && "increment" in (value as Row) ? (row[key] as number) + ((value as { increment: number }).increment) : value;
  }
}
export function memoryDatabase(users: Row[]) {
  const sessions: Row[] = [];
  const table = (rows: Row[], withUser = false) => ({
    findUnique: vi.fn(async ({ where }: { where: Row }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      return row ? { ...row, ...(withUser ? { user: users.find((user) => user.id === row.userId) } : {}) } : null;
    }),
    create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `s${rows.length + 1}`, revokedAt: null, replacedById: null, createdAt: new Date(), ...data }; rows.push(row); return row; }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const row = rows.find((candidate) => matches(candidate, where)); if (!row) throw new Error("P2025"); apply(row, data); return row; }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const hit = rows.filter((candidate) => matches(candidate, where)); hit.forEach((row) => apply(row, data)); return { count: hit.length }; }),
  });
  return {
    sessions,
    authUser: table(users),
    refreshSession: table(sessions, true),
    client: { findUnique: vi.fn(async () => null) },
    account: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
}
