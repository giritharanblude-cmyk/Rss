import { DuplicateMasterError, DuplicateNameError } from '../errors';
import type { UserRecord, UserRepository } from '../repositories/types';
import { hashPassword } from './passwords';

export type MasterSeed = {
  name: string;
  email: string;
  password: string;
};

export async function createMasterIfNone(
  users: UserRepository,
  seed: MasterSeed,
): Promise<UserRecord> {
  const masters = await users.countMasters();
  if (masters > 0) {
    throw new DuplicateMasterError();
  }
  const existing = await users.findByName(seed.name);
  if (existing) {
    throw new DuplicateNameError();
  }
  const passwordHash = await hashPassword(seed.password);
  return users.create({
    name: seed.name,
    email: seed.email,
    passwordHash,
    role: 'master',
  });
}
