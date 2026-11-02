import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "./modules/auth/auth.decorators";

/* Railway lo consulta sin parar: no cuenta para el limite de solicitudes. */
@SkipThrottle()
@Controller("health")
export class HealthController {
  @Public()
  @Get()
  health() {
    return { status: "ok" };
  }
}
