import { describe, expect, it, vi } from "vitest";
import { AuthController } from "../src/modules/auth/auth.controller";
import { AuthService } from "../src/modules/auth/auth.service";
import { AuthPrincipal } from "../src/modules/auth/auth.types";

const client: AuthPrincipal = { userId: "u1", username: "cliente@example.test", role: "CLIENT", clientId: "client-1", accountId: "account-1", accountType: "PREPAGO" };
const staff: AuthPrincipal = { userId: "u2", username: "gestor", role: "GESTOR", clientId: null, accountId: null, accountType: null };

/* El correo es solo la credencial; en pantalla se ve el nombre o la razón social. */
function service(clientRecord: { id: string; name: string; status: string } | null = { id: "client-1", name: "Comercial Andina S.A.", status: "ACTIVE" }) {
  const database = {
    authUser: { findUnique: vi.fn().mockResolvedValue({ id: "u1", username: client.username, passwordHash: "hash", role: "CLIENT", status: "ACTIVE", clientId: "client-1", accountId: "account-1", accountType: "PREPAGO", mustChangePassword: false }) },
    client: { findUnique: vi.fn().mockResolvedValue(clientRecord) },
    account: { findUnique: vi.fn().mockResolvedValue({ id: "account-1", clientId: "client-1", status: "ACTIVE" }) },
    refreshSession: { create: vi.fn().mockResolvedValue({}) },
  };
  const passwords = { verify: vi.fn().mockResolvedValue(true) };
  const accessTokens = { sign: vi.fn().mockReturnValue({ token: "token", expiresIn: 900 }) };
  return { database, auth: new AuthService(database as never, passwords as never, accessTokens as never) };
}

describe("nombre que se muestra al entrar", () => {
  it("a un cliente se le muestra su nombre o razón social, no el correo", async () => {
    const { auth } = service();
    expect(await auth.displayName(client)).toBe("Comercial Andina S.A.");
  });

  it("al equipo se le muestra su nombre, sin consultar clientes", async () => {
    const { auth, database } = service();
    database.authUser.findUnique.mockResolvedValueOnce({ name: "  Marta Pérez " });
    expect(await auth.displayName(staff)).toBe("Marta Pérez");
    expect(database.authUser.findUnique).toHaveBeenCalledWith({ where: { id: "u2" }, select: { name: true } });
    expect(database.client.findUnique).not.toHaveBeenCalled();
  });

  it("si la cuenta del equipo no tiene nombre (cuenta anterior), cae al usuario", async () => {
    const { auth, database } = service();
    database.authUser.findUnique.mockResolvedValueOnce({ name: null });
    expect(await auth.displayName(staff)).toBe("gestor");
  });

  it("si el cliente ya no existe o su nombre está vacío, cae al usuario en lugar de mostrar nada", async () => {
    expect(await service(null).auth.displayName(client)).toBe(client.username);
    expect(await service({ id: "client-1", name: "   ", status: "ACTIVE" }).auth.displayName(client)).toBe(client.username);
  });

  it("el nombre se consulta por el cliente del token, nunca por un dato que mande el navegador", async () => {
    const { auth, database } = service();
    await auth.displayName(client);
    expect(database.client.findUnique).toHaveBeenCalledWith({ where: { id: "client-1" }, select: { name: true } });
  });

  it("al abrir sesión, la respuesta lleva el nombre aparte del principal firmado", async () => {
    const { auth } = service();
    const result = await auth.login(client.username, "1234");
    expect(result.displayName).toBe("Comercial Andina S.A.");
    // El token firma el principal tal cual: el nombre no es de seguridad y no entra en él.
    expect(result.principal).not.toHaveProperty("displayName");
  });

  it("/auth/me devuelve el mismo nombre que el login", async () => {
    const auth = { displayName: vi.fn().mockResolvedValue("Comercial Andina S.A.") };
    const controller = new AuthController(auth as never);
    expect(await controller.me(client)).toEqual({ user: { ...client, displayName: "Comercial Andina S.A." } });
    expect(auth.displayName).toHaveBeenCalledWith(client);
  });
});

describe("mensaje de credenciales incorrectas", () => {
  it("habla de correo, no de usuario, y es el mismo si el correo no existe o la clave falla", async () => {
    const { auth, database } = service();
    database.authUser.findUnique.mockResolvedValueOnce(null);
    await expect(auth.login("nadie@example.test", "1234")).rejects.toMatchObject({ message: "Correo o contraseña incorrectos" });
    const { auth: conClaveMala } = service();
    (conClaveMala as unknown as { passwords: { verify: (...a: unknown[]) => unknown } }).passwords.verify = vi.fn().mockResolvedValue(false);
    await expect(conClaveMala.login(client.username, "mala")).rejects.toMatchObject({ message: "Correo o contraseña incorrectos" });
  });
});
