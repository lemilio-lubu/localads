import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested, IsIn } from "class-validator";

export class ListNotificationsQueryDto {
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @Transform(({ value }) => value === true || value === "true") @IsBoolean() unreadOnly?: boolean;
}

/* ids o all, no los dos: lo comprueba el controlador. */
export class MarkNotificationsReadDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(64, { each: true }) ids?: string[];
  @IsOptional() @IsBoolean() all?: boolean;
}

export class UpdateNotificationPreferenceDto {
  @IsString() @MaxLength(40) key!: string;
  @IsIn(["push", "email"]) channel!: "push" | "email";
  @IsBoolean() enabled!: boolean;
}

/* Lo que da PushSubscription.toJSON() en el navegador. */
export class PushSubscriptionKeysDto {
  @IsString() @MaxLength(256) p256dh!: string;
  @IsString() @MaxLength(256) auth!: string;
}

export class RegisterPushSubscriptionDto {
  @IsString() @MaxLength(2048) endpoint!: string;
  @ValidateNested() @Type(() => PushSubscriptionKeysDto) keys!: PushSubscriptionKeysDto;
}

export class RemovePushSubscriptionDto {
  @IsString() @MaxLength(2048) endpoint!: string;
}
