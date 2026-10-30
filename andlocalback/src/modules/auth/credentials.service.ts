import { Injectable } from "@nestjs/common";
import { ApplicationError } from "../../common/errors/application.error";
import { PrismaService } from "../../database/prisma.service";
import { PasswordService } from "./password.service";
import { generateTemporaryPassword } from "./temporary-password";

export type PreparedCredentials = { username: string; temporaryPassword: string; passwordHash: string };

/* Emite credenciales para cualquier cuenta nueva: cliente, gestor o admin. No
   importa el port de clientes a proposito, para no invertir la dependencia
   entre modulos; el cableado lo hace clients.module contra el simbolo. */
@Injectable()
export class CredentialsService {
  constructor(private readonly database: PrismaService, private readonly passwords: PasswordService) {}

  /* El correo es el usuario del cliente: un solo dato para entrar, sin
     derivar nada. Va en minusculas porque el login normaliza igual. */
  async prepare(email: string): Promise<PreparedCredentials> {
    const username = email.trim().toLowerCase();
    if (await this.database.authUser.findUnique({ where: { username }, select: { id: true } })) throw new ApplicationError("USERNAME_TAKEN", "Ya existe un acceso con este correo", 409);
    return this.issue(username);
  }

  /* Restablecer una clave es generar otra temporal y volver a exigir el
     cambio: el mismo camino que al crear la cuenta, sin tocar el usuario. */
  async issue(username: string): Promise<PreparedCredentials> {
    const temporaryPassword = generateTemporaryPassword();
    return { username, temporaryPassword, passwordHash: await this.passwords.hash(temporaryPassword) };
  }
}
