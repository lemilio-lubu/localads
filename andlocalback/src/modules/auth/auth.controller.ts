import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { CurrentUser, Public } from "./auth.decorators";
import { AuthPrincipal } from "./auth.types";

class LoginDto { @IsString() @IsNotEmpty() @MaxLength(120) username!: string; @IsString() @MinLength(4) @MaxLength(200) password!: string; }
const cookieName = "andlocal_refresh"; const cookiePath = "/api/v1/auth";
function readCookie(request: Request) { const cookies = request.headers.cookie?.split(";").map((value) => value.trim().split("=")) ?? []; const value = cookies.find(([name]) => name === cookieName)?.[1]; return value ? decodeURIComponent(value) : undefined; }
function setRefreshCookie(response: Response, token: string) { response.cookie(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: cookiePath, maxAge: 7 * 24 * 60 * 60 * 1000 }); }

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post("login") async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) { const result = await this.auth.login(body.username, body.password); setRefreshCookie(response, result.refreshToken); return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.principal }; }
  @Public() @Post("refresh") async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) { const token = readCookie(request); if (!token) return this.auth.refresh(""); const result = await this.auth.refresh(token); setRefreshCookie(response, result.refreshToken); return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.principal }; }
  @Public() @Post("logout") async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) { await this.auth.revoke(readCookie(request)); response.clearCookie(cookieName, { path: cookiePath }); return { success: true }; }
  @Get("me") me(@CurrentUser() user: AuthPrincipal) { return { user }; }
}

