import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password/password.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
