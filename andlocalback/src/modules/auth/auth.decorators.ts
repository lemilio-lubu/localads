import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import { AuthPrincipal, AuthRole } from "./auth.types";
export const IS_PUBLIC_KEY = "auth:is-public"; export const ROLES_KEY = "auth:roles"; export const ALLOWS_TEMPORARY_PASSWORD_KEY = "auth:allows-temporary-password";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
/* Las unicas rutas alcanzables con una clave temporal sin usar: ver quien
   eres y cambiarla. Todo lo demas responde PASSWORD_CHANGE_REQUIRED. */
export const AllowsTemporaryPassword = () => SetMetadata(ALLOWS_TEMPORARY_PASSWORD_KEY, true);
export const Roles = (...roles: AuthRole[]) => SetMetadata(ROLES_KEY, roles);
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => (context.switchToHttp().getRequest() as { user: AuthPrincipal }).user);

