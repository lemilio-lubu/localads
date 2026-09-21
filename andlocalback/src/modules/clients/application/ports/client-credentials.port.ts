/* Un cliente sin acceso no puede entrar al portal, asi que crear el cliente y
   crear su usuario son la misma operacion. El modulo de clientes no sabe
   hashear ni conoce AuthUser: pide credenciales ya preparadas y las entrega al
   repositorio, que escribe todo en una sola transaccion. */
export type PreparedCredentials = {
  username: string;
  /* En claro y solo aqui: viaja una vez a la respuesta de creacion y no se
     guarda en ninguna parte. Lo que se persiste es passwordHash. */
  temporaryPassword: string;
  passwordHash: string;
};

export interface ClientCredentialsIssuer {
  prepare(email: string): Promise<PreparedCredentials>;
}

export const CLIENT_CREDENTIALS_ISSUER = Symbol("CLIENT_CREDENTIALS_ISSUER");
