import bcrypt from 'bcryptjs';

/** Hash a plaintext password for storage. cost factor 12 ≈ ~250ms on modern CPUs. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
