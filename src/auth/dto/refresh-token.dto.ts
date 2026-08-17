import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Refresh input. The opaque refresh token issued at login is carried
 * verbatim — there is no normalization concern here (unlike email), and
 * no length/format policy is enforced beyond "present": an unrecognized
 * value is rejected as an authentication failure (401) by AuthService,
 * not a validation failure, so guessed/garbage tokens don't get a
 * different response shape than a merely-expired one.
 */
export class RefreshTokenDto {
  @ApiProperty({ description: 'The opaque refresh token issued at login' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
