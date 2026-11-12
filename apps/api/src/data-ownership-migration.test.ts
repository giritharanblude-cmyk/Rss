import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { migrateDataOwnership } from './db/migrate';

const ownershipTables = ['alert_rules', 'deliveries', 'recipients', 'sources'] as const;
type OwnershipTable = (typeof ownershipTables)[number];
type OwnershipRow = { id: string; owner_user_id: string | null };
type OwnershipState = {
  users: { id: string; role: string }[];
} & Record<OwnershipTable, OwnershipRow[]>;

function ownershipPool(
  state: OwnershipState,
  corruptAfterBackfill = false,
): { pool: Pool; rollback: ReturnType<typeof vi.fn> } {
  let snapshot: OwnershipState | null = null;
  let backup: { table_name: OwnershipTable; id: string; owner_user_id: string | null }[] = [];
  const rollback = vi.fn(async () => {
    if (snapshot) Object.assign(state, structuredClone(snapshot));
  });
  const client = {
    query: async (statement: string, values?: unknown[]) => {
      const sql = statement.trim().replace(/\s+/g, ' ').toUpperCase();
      if (sql === 'BEGIN') {
        snapshot = structuredClone(state);
        return { rows: [] };
      }
      if (sql === 'COMMIT') return { rows: [] };
      if (sql === 'ROLLBACK') {
        await rollback();
        return { rows: [] };
      }
      if (sql.startsWith('LOCK TABLE')) return { rows: [] };
      if (sql.startsWith("SELECT ID FROM USERS WHERE ROLE = 'MASTER'")) {
        return { rows: state.users.filter((user) => user.role === 'master') };
      }
      if (sql.startsWith('CREATE TEMP TABLE DATA_OWNER_BACKFILL_BACKUP')) {
        backup = ownershipTables.flatMap((table) =>
          state[table].map((row) => ({ table_name: table, ...row })),
        );
        return { rows: [] };
      }
      const update = /^UPDATE (ALERT_RULES|DELIVERIES|RECIPIENTS|SOURCES) SET OWNER_USER_ID/.exec(
        sql,
      );
      if (update?.[1]) {
        const table = update[1].toLowerCase() as OwnershipTable;
        const masterId = values?.[0] as string;
        let rowCount = 0;
        for (const row of state[table]) {
          if (row.owner_user_id === null) {
            row.owner_user_id = masterId;
            rowCount += 1;
          }
        }
        if (corruptAfterBackfill && rowCount > 0) {
          state[table][0]!.owner_user_id = 'wrong-owner';
        }
        return { rows: [], rowCount };
      }
      const verifyTable = /FULL OUTER JOIN ([A-Z_]+) AS CURRENT/.exec(sql)?.[1];
      if (verifyTable) {
        const table = verifyTable.toLowerCase() as OwnershipTable;
        const masterId = values?.[0] as string;
        const originalRows = backup.filter((row) => row.table_name === table);
        const currentRows = state[table];
        const currentById = new Map(currentRows.map((row) => [row.id, row]));
        let mismatches = Math.abs(originalRows.length - currentRows.length);
        for (const original of originalRows) {
          const current = currentById.get(original.id);
          if (!current || current.owner_user_id !== (original.owner_user_id ?? masterId)) {
            mismatches += 1;
          }
          currentById.delete(original.id);
        }
        mismatches += currentById.size;
        return { rows: [{ mismatches }] };
      }
      if (sql.startsWith('ALTER TABLE') && sql.includes('SET NOT NULL')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in ownership migration test: ${statement}`);
    },
    release: vi.fn(),
  };
  return { pool: { connect: async () => client } as unknown as Pool, rollback };
}

function initialState(): OwnershipState {
  const row = (id: string): OwnershipRow => ({ id, owner_user_id: null });
  return {
    users: [
      { id: 'master-1', role: 'master' },
      { id: 'member-1', role: 'member' },
    ],
    alert_rules: [row('alert-rule-1')],
    deliveries: [row('delivery-1')],
    recipients: [row('recipient-1')],
    sources: [row('source-1')],
  };
}

describe('data ownership migration', () => {
  it('backfills every existing row to the master account', async () => {
    const state = initialState();
    const { pool } = ownershipPool(state);

    await expect(migrateDataOwnership(pool)).resolves.toBe(4);
    for (const table of ownershipTables) {
      expect(state[table].every((row) => row.owner_user_id === 'master-1')).toBe(true);
    }
  });

  it('is idempotent and leaves rows created later by members alone', async () => {
    const state = initialState();
    const { pool } = ownershipPool(state);
    await migrateDataOwnership(pool);
    state.sources.push({ id: 'member-source', owner_user_id: 'member-1' });

    await expect(migrateDataOwnership(pool)).resolves.toBe(0);
    expect(state.sources.at(-1)?.owner_user_id).toBe('member-1');
  });

  it('rolls back the backfill if owner verification fails', async () => {
    const state = initialState();
    const original = structuredClone(state);
    const { pool, rollback } = ownershipPool(state, true);

    await expect(migrateDataOwnership(pool)).rejects.toThrow(
      'Data ownership migration verification failed for alert_rules.',
    );
    expect(state).toEqual(original);
    expect(rollback).toHaveBeenCalledOnce();
  });
});
