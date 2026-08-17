import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Isolates all password hashing/verification behind a single abstraction so
 * that no other service needs to know which hashing algorithm/library is
 * used.
 *
 * Uses Argon2id (the current OWASP-recommended default for new
 * applications) with the library's secure default cost parameters.
 */
@Injectable()
export class PasswordService {
  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, { type: argon2.argon2id });
  }

  async verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    return argon2.verify(passwordHash, plainPassword);
  }
}
