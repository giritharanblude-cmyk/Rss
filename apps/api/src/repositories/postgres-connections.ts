import type { Database } from '../db/client';
import { connectionStatus } from '../db/schema';
import type { ConnectionRecord, ConnectionRepository } from '../delivery/connections';

export class PostgresConnectionRepository implements ConnectionRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<ConnectionRecord[]> {
    const rows = await this.db.select().from(connectionStatus);
    return rows.map((row) => ({
      service: row.service,
      state: row.state,
      checkedAt: row.checkedAt,
      detail: row.detail,
    }));
  }

  async save(record: ConnectionRecord): Promise<void> {
    await this.db
      .insert(connectionStatus)
      .values(record)
      .onConflictDoUpdate({
        target: connectionStatus.service,
        set: {
          state: record.state,
          checkedAt: record.checkedAt,
          detail: record.detail,
        },
      });
  }
}
