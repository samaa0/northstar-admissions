import { createClient } from '@libsql/client';

function normalizedArgs(sql, values) {
  if (values.length !== 1 || !values[0] || Array.isArray(values[0]) || typeof values[0] !== 'object') {
    return { sql, args: values };
  }

  const named = values[0];
  const args = [];
  const statement = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
    args.push(named[name]);
    return '?';
  });
  return { sql: statement, args };
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    typeof value === 'bigint' ? Number(value) : value,
  ]));
}

function createStatement(executor, sql) {
  async function execute(values) {
    return executor.execute(normalizedArgs(sql, values));
  }

  return {
    async all(...values) {
      const result = await execute(values);
      return result.rows.map(normalizeRow);
    },
    async get(...values) {
      const result = await execute(values);
      return result.rows[0] ? normalizeRow(result.rows[0]) : undefined;
    },
    async run(...values) {
      const result = await execute(values);
      return {
        changes: Number(result.rowsAffected),
        lastInsertRowid: result.lastInsertRowid === undefined ? undefined : Number(result.lastInsertRowid),
      };
    },
  };
}

function createAdapter(client, executor = client) {
  return {
    prepare(sql) {
      return createStatement(executor, sql);
    },
    async runTransaction(callback) {
      const transaction = await client.transaction('write');
      try {
        const result = await callback(createAdapter(client, transaction));
        await transaction.commit();
        return result;
      } catch (error) {
        await transaction.rollback();
        throw error;
      } finally {
        transaction.close();
      }
    },
    close() {
      client.close();
    },
  };
}

export function createCloudDatabase() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required');
  }
  const client = createClient({ url, authToken, intMode: 'number' });
  return createAdapter(client);
}
