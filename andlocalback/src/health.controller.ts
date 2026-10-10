import { Controller, Get } from "@nestjs/common";
import { Public } from "./modules/auth/auth.decorators";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  health() {
    return { status: "ok" };
  }
}
