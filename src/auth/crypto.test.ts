import {
  RECOVERY_ALPHABET,
  generateRecoveryCode,
  generateSessionToken,
  hashRecoveryCode,
  hashSecret,
  hashToken,
  normalizeRecoveryCode,
  verifyRecoveryCode,
  verifySecret,
} from './crypto';

describe('hashSecret / verifySecret', () => {
  it('verifies the right secret and rejects a wrong one', async () => {
    const stored = await hashSecret('correct horse battery');
    expect(stored.startsWith('scrypt$')).toBe(true);
    await expect(verifySecret('correct horse battery', stored)).resolves.toBe(true);
    await expect(verifySecret('wrong', stored)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const a = await hashSecret('same');
    const b = await hashSecret('same');
    expect(a).not.toBe(b);
  });

  it('returns false for a malformed stored value instead of throwing', async () => {
    await expect(verifySecret('x', 'not-a-hash')).resolves.toBe(false);
  });
});

describe('recovery codes', () => {
  it('has four groups of five characters from the unambiguous alphabet', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    for (const ch of code.replace(/-/g, '')) {
      expect(RECOVERY_ALPHABET).toContain(ch);
    }
    expect(RECOVERY_ALPHABET).not.toMatch(/[01ILO]/);
  });

  it('is different every time', () => {
    expect(generateRecoveryCode()).not.toBe(generateRecoveryCode());
  });

  it.each([
    ['k7qx2-abcde-fghjk-mnpqr', 'K7QX2ABCDEFGHJKMNPQR'],
    ['K7QX2ABCDEFGHJKMNPQR', 'K7QX2ABCDEFGHJKMNPQR'],
    [' k7qx2 abcde fghjk mnpqr ', 'K7QX2ABCDEFGHJKMNPQR'],
  ])('normalizes %p', (input, expected) => {
    expect(normalizeRecoveryCode(input)).toBe(expected);
  });
});

describe('recovery code hashes', () => {
  it('uses a fast SHA-256 hash and verifies only the right code', async () => {
    const stored = hashRecoveryCode('AAAAABBBBBCCCCCDDDDD');
    expect(stored).toMatch(/^sha256\$[0-9a-f]{64}$/);
    expect(verifyRecoveryCode('AAAAABBBBBCCCCCDDDDD', stored)).toBe(true);
    expect(verifyRecoveryCode('AAAAABBBBBCCCCCDDDDE', stored)).toBe(false);
  });

  it('rejects any other stored format without running scrypt', async () => {
    const other = await hashSecret('AAAAABBBBBCCCCCDDDDD');
    expect(verifyRecoveryCode('AAAAABBBBBCCCCCDDDDD', other)).toBe(false);
  });
});

describe('session tokens', () => {
  it('generates 32-byte base64url tokens and hashes them to hex', () => {
    const token = generateSessionToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
  });
});
