import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import { AuthPrincipal, AuthRole } from "./auth.types";
export const IS_PUBLIC_KEY = "auth:is-public"; export const ROLES_KEY = "auth:roles";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: AuthRole[]) => SetMetadata(ROLES_KEY, roles);
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => (context.switchToHttp().getRequest() as { user: AuthPrincipal }).user);

