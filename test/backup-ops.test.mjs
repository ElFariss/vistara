import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackup, restoreBackup } from '../scripts/backup-lib.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('createBackup copies sqlite files and uploads into a timestamped backup directory', async () => {
  const dataDir = tempDir('vistara-data-');
  const backupRootDir = tempDir('vistara-backup-');
  const dbPath = path.join(dataDir, 'umkm.db');
  const uploadDir = path.join(dataDir, 'uploads');

  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(dbPath, 'db-main');
  fs.writeFileSync(`${dbPath}-wal`, 'db-wal');
  fs.writeFileSync(path.join(uploadDir, 'sample.csv'), 'tanggal,omzet\n2025-01-01,1000\n');

  const { backupDir, manifest } = await createBackup({
    dataDir,
    dbPath,
    backupRootDir,
    now: new Date('2026-03-08T10:00:00.000Z'),
  });

  assert.match(path.basename(backupDir), /^backup-2026-03-08T10-00-00$/);
  assert.equal(manifest.uploads_copied, true);
  assert.deepEqual(
    manifest.db_files.map((file) => file.kind).sort(),
    ['main', 'wal'],
  );
  assert.equal(fs.readFileSync(path.join(backupDir, 'db', 'umkm.db'), 'utf8'), 'db-main');
  assert.equal(fs.readFileSync(path.join(backupDir, 'uploads', 'sample.csv'), 'utf8'), 'tanggal,omzet\n2025-01-01,1000\n');
});

test('restoreBackup recreates sqlite files and uploads from a backup manifest', async () => {
  const dataDir = tempDir('vistara-restore-data-');
  const backupRootDir = tempDir('vistara-restore-backup-');
  const dbPath = path.join(dataDir, 'umkm.db');
  const uploadDir = path.join(dataDir, 'uploads');

  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(dbPath, 'old-main');
  fs.writeFileSync(path.join(uploadDir, 'old.csv'), 'old');

  const { backupDir } = await createBackup({
    dataDir,
    dbPath,
    backupRootDir,
    now: new Date('2026-03-08T10:05:00.000Z'),
  });

  fs.writeFileSync(dbPath, 'new-main');
  fs.writeFileSync(`${dbPath}-shm`, 'new-shm');
  fs.writeFileSync(path.join(uploadDir, 'new.csv'), 'new');

  const result = await restoreBackup({
    backupDir,
    dataDir,
    dbPath,
  });

  assert.equal(fs.readFileSync(dbPath, 'utf8'), 'old-main');
  assert.equal(fs.existsSync(`${dbPath}-shm`), false);
  assert.equal(fs.readFileSync(path.join(uploadDir, 'old.csv'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(uploadDir, 'new.csv')), false);
  assert.equal(result.restoredUploads, true);
});
