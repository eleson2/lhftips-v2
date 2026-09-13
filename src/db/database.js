import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;
let dbPath = null;
let SQL = null;
let inTransaction = false;

async function initSql() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

export async function getDatabase(path = 'lhftips.db') {
  if (!db) {
    await initSql();
    dbPath = path;

    if (existsSync(path)) {
      const buffer = readFileSync(path);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  }
  return db;
}

export async function initDatabase(path = 'lhftips.db') {
  const database = await getDatabase(path);
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  database.run(schema);
  saveDatabase();
  return database;
}

export function saveDatabase() {
  if (db && dbPath && !inTransaction) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  }
}

function forceSave() {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  }
}

export function beginTransaction() {
  if (inTransaction) {
    throw new Error('Transaction already in progress');
  }
  db.run('BEGIN TRANSACTION');
  inTransaction = true;
}

export function commit() {
  if (!inTransaction) {
    throw new Error('No transaction in progress');
  }
  db.run('COMMIT');
  inTransaction = false;
  forceSave();
}

export function rollback() {
  if (!inTransaction) {
    throw new Error('No transaction in progress');
  }
  db.run('ROLLBACK');
  inTransaction = false;
}

export function isInTransaction() {
  return inTransaction;
}

export function closeDatabase() {
  if (db) {
    if (inTransaction) {
      db.run('ROLLBACK');
      inTransaction = false;
    }
    forceSave();
    db.close();
    db = null;
    dbPath = null;
  }
}

// Helper functions to match better-sqlite3's API
export function prepare(sql) {
  return {
    run: (...params) => {
      db.run(sql, params);
      // Read the row id BEFORE persisting: sql.js implements export() by closing
      // and reopening the connection, which resets last_insert_rowid() to 0.
      // Reading it afterwards handed every fresh INSERT an id of 0.
      const result = {
        changes: db.getRowsModified(),
        lastInsertRowid: getLastInsertRowId()
      };
      saveDatabase();
      return result;
    },
    get: (...params) => {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      }
      stmt.free();
      return undefined;
    },
    all: (...params) => {
      const results = [];
      const stmt = db.prepare(sql);
      stmt.bind(params);
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    }
  };
}

function getLastInsertRowId() {
  const result = db.exec('SELECT last_insert_rowid() as id');
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  return null;
}

export function exec(sql) {
  db.run(sql);
  saveDatabase();
}
