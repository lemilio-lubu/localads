import { Injectable } from "@nestjs/common";
import { ApplicationError } from "../../common/errors/application.error";
import { PrismaService } from "../../database/prisma.service";
import { PasswordService } from "./password.service";
import { deriveUsername, generateTemporaryPassword } from "./temporary-password";

export type PreparedCredentials = { username: string; temporaryPassword: string; passwordHash: string };

/* Emite credenciales para cualquier cuenta nueva: cliente, gestor o admin. No
   importa el port de clientes a proposito, para no invertir la dependencia
   entre modulos; el cableado lo hace clients.module contra el simbolo. */
@Injectable()
export class CredentialsService {
  constructor(private readonly database: PrismaService, private readonly passwords: PasswordService) {}

  async prepare(email: string): Promise<PreparedCredentials> {
    const username = await deriveUsername(email, async (candidate) => Boolean(await this.database.authUser.findUnique({ where: { username: candidate }, select: { id: true } })));
    if (!username) throw new ApplicationError("USERNAME_TAKEN", "No fue posible derivar un usuario libre a partir del correo", 409);
    return this.issue(username);
  }

  /* Restablecer una clave es generar otra temporal y volver a exigir el
     cambio: el mismo camino que al crear la cuenta, sin tocar el usuario. */
  async issue(username: string): Promise<PreparedCredentials> {
    const temporaryPassword = generateTemporaryPassword();
    return { username, temporaryPassword, passwordHash: await this.passwords.hash(temporaryPassword) };
  }
}
