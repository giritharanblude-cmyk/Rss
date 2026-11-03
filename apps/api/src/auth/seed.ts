import { HttpError } from '../errors';
import type { UserRecord, UserRepository } from '../repositories/types';
import { hashPassword } from './passwords';

export type MasterSeed = {
  name: string;
  email: string;
  password: string;
};

export class DuplicateMasterError extends HttpError {
  constructor() {
    super(409, 'A master user already exists. Refusing to create another.');
  }
}

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
    throw new HttpError(409, 'That name is already in use.');
  }
  const passwordHash = await hashPassword(seed.password);
  return users.create({
    name: seed.name,
    email: seed.email,
    passwordHash,
    role: 'master',
  });
}
