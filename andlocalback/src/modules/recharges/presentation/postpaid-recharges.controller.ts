import { Body, Controller, Post, UseFilters } from "@nestjs/common";
import { CreatePostpaidRecharge } from "../application/use-cases/create-postpaid-recharge";
import { ApplicationErrorFilter } from "./application-error.filter";
import { CreatePostpaidRechargeDto } from "./dto/create-postpaid-recharge.dto";
import { Roles } from "../../auth/auth.decorators";

@Controller("postpaid-recharges")
@UseFilters(ApplicationErrorFilter)
@Roles("ADMIN")
export class PostpaidRechargesController {
  constructor(private readonly createRecharge: CreatePostpaidRecharge) {}

  @Post()
  create(@Body() body: CreatePostpaidRechargeDto) {
    return this.createRecharge.execute(body);
  }
}
