import type { ConnectionRecord, ConnectionRepository } from '../delivery/connections';

export class MemoryConnectionRepository implements ConnectionRepository {
  private readonly records = new Map<string, ConnectionRecord>();

  async list(): Promise<ConnectionRecord[]> {
    return [...this.records.values()].map((record) => ({
      ...record,
      checkedAt: new Date(record.checkedAt),
    }));
  }

  async save(record: ConnectionRecord): Promise<void> {
    this.records.set(record.service, { ...record, checkedAt: new Date(record.checkedAt) });
  }
}
