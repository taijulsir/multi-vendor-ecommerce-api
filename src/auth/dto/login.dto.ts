import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/**
 * Login input. Only carries credentials for verification — password
 * policy (e.g. minimum length) is enforced at registration, not here, so a
 * malformed/guessed password is rejected by AuthService.login() with the
 * same generic "Invalid email or password" outcome as any other wrong
 * password, instead of a distinguishable 400 at the DTO layer.
 */
export class LoginDto {
  @ApiProperty({ example: 'jane.doe@example.com' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'StrongPassw0rd!' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
