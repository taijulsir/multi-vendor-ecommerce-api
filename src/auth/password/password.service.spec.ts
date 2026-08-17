import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  it('hashes a password into a different, non-empty string', async () => {
    const hash = await service.hash('correct-horse-battery-staple');

    expect(hash).toEqual(expect.any(String));
    expect(hash).not.toBe('correct-horse-battery-staple');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await service.hash('correct-horse-battery-staple');

    await expect(
      service.verify(hash, 'correct-horse-battery-staple'),
    ).resolves.toBe(true);
  });

  it('rejects an incorrect password against an existing hash', async () => {
    const hash = await service.hash('correct-horse-battery-staple');

    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(
      false,
    );
  });
});
