import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Shape of an address snapshot, matching exactly the illustrative JSON
 * examples in docs/database/order.md §21 (shipping) and §22 (billing) —
 * the field names, not invented ones. The document itself states "the
 * exact address fields will be finalized with the User/Address domain"
 * (§21), so this is a best-effort implementation of provisional
 * guidance, not a fully specified contract; see this phase's final
 * report. `addressLine2` and `state` are optional because the doc's own
 * shipping example shows `addressLine2: null` and its billing example
 * omits `state` entirely.
 */
export class AddressDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: '+8801XXXXXXXXX' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'House 10, Road 5' })
  @IsString()
  @IsNotEmpty()
  addressLine1: string;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiProperty({ example: 'Dhaka' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiPropertyOptional({ example: 'Dhaka' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({ example: '1207' })
  @IsString()
  @IsNotEmpty()
  postalCode: string;

  @ApiProperty({ example: 'BD' })
  @IsString()
  @IsNotEmpty()
  country: string;
}
