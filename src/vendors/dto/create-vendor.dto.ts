import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Vendor onboarding input, scoped to the client-provided fields defined
 * for `Vendor` in docs/database/vendor-shop.md §1 (Fields). Server-
 * controlled fields (`userId`, `status`, `verificationStatus`,
 * `verifiedAt`, ...) are intentionally not part of this DTO — `userId`
 * always comes from the authenticated caller (`@CurrentUser()`), never
 * from the request body, and `status`/`verificationStatus` default to
 * `PENDING` per docs/database/vendor-shop.md §6 (Vendor Business Rules).
 */
export class CreateVendorDto {
  @ApiProperty({ example: 'Taijul Electronics' })
  @IsString()
  @IsNotEmpty()
  businessName: string;

  @ApiPropertyOptional({ example: 'contact@taijul-electronics.example' })
  @IsOptional()
  @IsEmail()
  businessEmail?: string;

  @ApiPropertyOptional({ example: '+8801XXXXXXXXX' })
  @IsOptional()
  @IsString()
  businessPhone?: string;
}
