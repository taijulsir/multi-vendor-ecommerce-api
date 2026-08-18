import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { StringValue } from 'ms';

import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthorizationService } from './authorization/authorization.service';
import { OwnershipService } from './authorization/ownership.service';
import { AuthorizationGuard } from './guards/authorization.guard';
import { ProductOwnershipGuard } from './guards/product-ownership.guard';
import { VendorOrderOwnershipGuard } from './guards/vendor-order-ownership.guard';
import { VendorShopOwnershipGuard } from './guards/vendor-shop-ownership.guard';
import { PasswordService } from './password/password.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshTokenService } from './token/refresh-token.service';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: configService.getOrThrow<StringValue>(
            'JWT_ACCESS_EXPIRES_IN',
          ),
          algorithm: 'HS256',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    JwtStrategy,
    RefreshTokenService,
    AuthorizationService,
    AuthorizationGuard,
    OwnershipService,
    VendorShopOwnershipGuard,
    ProductOwnershipGuard,
    VendorOrderOwnershipGuard,
  ],
  exports: [
    AuthService,
    PasswordService,
    RefreshTokenService,
    AuthorizationService,
    AuthorizationGuard,
    OwnershipService,
    VendorShopOwnershipGuard,
    ProductOwnershipGuard,
    VendorOrderOwnershipGuard,
  ],
})
export class AuthModule {}
