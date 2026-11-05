import { DuplicateNameError, ForbiddenError, HttpError } from '../errors';
import type { CreateMemberBody, ResetMemberPasswordBody } from '@healthcare/shared';
import type { UserRecord, UserRepository } from '../repositories/types';
import { hashPassword } from './passwords';

export class MemberService {
  constructor(private readonly users: UserRepository) {}

  private assertMaster(actor: UserRecord): void {
    if (actor.role !== 'master') {
      throw new ForbiddenError();
    }
  }

  async list(actor: UserRecord): Promise<UserRecord[]> {
    this.assertMaster(actor);
    return this.users.listMembers();
  }

  async create(actor: UserRecord, input: CreateMemberBody): Promise<UserRecord> {
    this.assertMaster(actor);

    const existing = await this.users.findByName(input.name);
    if (existing) {
      throw new DuplicateNameError();
    }

    const passwordHash = await hashPassword(input.password);
    return this.users.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: 'member',
    });
  }

  async setDisabled(actor: UserRecord, memberId: string, disabled: boolean): Promise<UserRecord> {
    this.assertMaster(actor);
    if (actor.id === memberId) {
      throw new ForbiddenError('You cannot disable your own account.');
    }
    const updated = await this.users.setDisabled(memberId, disabled);
    if (!updated) {
      throw new HttpError(404, 'That member was not found.');
    }
    if (updated.role !== 'member') {
      throw new ForbiddenError('Only members can be disabled here.');
    }
    return updated;
  }

  async resetPassword(
    actor: UserRecord,
    memberId: string,
    input: ResetMemberPasswordBody,
  ): Promise<void> {
    this.assertMaster(actor);
    if (actor.id === memberId) {
      throw new ForbiddenError('You cannot reset your own account here.');
    }
    const member = await this.users.findById(memberId);
    if (!member) {
      throw new HttpError(404, 'That member was not found.');
    }
    if (member.role !== 'member') {
      throw new ForbiddenError('Only member accounts can be reset here.');
    }
    const passwordHash = await hashPassword(input.password);
    if (!(await this.users.updatePasswordHash(memberId, passwordHash))) {
      throw new HttpError(404, 'That member was not found.');
    }
  }
}
