import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackup, restoreBackup } from '../scripts/backup-lib.mjs';
import { initializeDatabase, run, get } from '../src/db.mjs';

await initializeDatabase();

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('createBackup snapshots Postgres tables and uploads into a timestamped backup directory', async () => {
  const dataDir = tempDir('vistara-data-');
  const backupRootDir = tempDir('vistara-backup-');
  const uploadDir = path.join(dataDir, 'uploads');

  await run('DELETE FROM tenants');

  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, 'sample.csv'), 'tanggal,omzet\n2025-01-01,1000\n');

  await run(
    `
      INSERT INTO tenants (id, name, industry, city, timezone, currency, created_at)
      VALUES (:id, :name, :industry, :city, :timezone, :currency, :created_at)
    `,
    {
      id: 'tenant-backup',
      name: 'Tenant Backup',
      industry: 'Retail',
      city: 'Jakarta',
      timezone: 'Asia/Jakarta',
      currency: 'IDR',
      created_at: new Date('2026-03-08T09:00:00.000Z').toISOString(),
    },
  );

  const { backupDir, manifest } = await createBackup({
    dataDir,
    backupRootDir,
    now: new Date('2026-03-08T10:00:00.000Z'),
  });

  assert.match(path.basename(backupDir), /^backup-2026-03-08T10-00-00$/);
  assert.equal(manifest.uploads_copied, true);
  const tenantsSnapshot = JSON.parse(fs.readFileSync(path.join(backupDir, 'db', 'tenants.json'), 'utf8'));
  assert.equal(tenantsSnapshot.length, 1);
  assert.equal(tenantsSnapshot[0]?.id, 'tenant-backup');
  assert.equal(fs.readFileSync(path.join(backupDir, 'uploads', 'sample.csv'), 'utf8'), 'tanggal,omzet\n2025-01-01,1000\n');
});

test('restoreBackup replays Postgres tables and uploads from a backup manifest', async () => {
  const dataDir = tempDir('vistara-restore-data-');
  const backupRootDir = tempDir('vistara-restore-backup-');
  const uploadDir = path.join(dataDir, 'uploads');

  await run('DELETE FROM tenants');

  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, 'old.csv'), 'old');

  await run(
    `
      INSERT INTO tenants (id, name, industry, city, timezone, currency, created_at)
      VALUES (:id, :name, :industry, :city, :timezone, :currency, :created_at)
    `,
    {
      id: 'tenant-original',
      name: 'Tenant Original',
      industry: 'Retail',
      city: 'Bandung',
      timezone: 'Asia/Jakarta',
      currency: 'IDR',
      created_at: new Date('2026-03-08T09:30:00.000Z').toISOString(),
    },
  );

  const { backupDir } = await createBackup({
    dataDir,
    backupRootDir,
    now: new Date('2026-03-08T10:05:00.000Z'),
  });

  fs.writeFileSync(path.join(uploadDir, 'new.csv'), 'new');

  await run(
    `
      INSERT INTO tenants (id, name, industry, city, timezone, currency, created_at)
      VALUES (:id, :name, :industry, :city, :timezone, :currency, :created_at)
    `,
    {
      id: 'tenant-new',
      name: 'Tenant New',
      industry: 'Retail',
      city: 'Surabaya',
      timezone: 'Asia/Jakarta',
      currency: 'IDR',
      created_at: new Date('2026-03-08T09:45:00.000Z').toISOString(),
    },
  );

  const result = await restoreBackup({
    backupDir,
    dataDir,
  });

  const remainingTenant = await get(`SELECT id FROM tenants ORDER BY id LIMIT 1`);
  const totalTenants = await get(`SELECT COUNT(*) AS value FROM tenants`);
  assert.equal(remainingTenant?.id, 'tenant-original');
  assert.equal(Number(totalTenants?.value || 0), 1);
  assert.equal(fs.readFileSync(path.join(uploadDir, 'old.csv'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(uploadDir, 'new.csv')), false);
  assert.equal(result.restoredUploads, true);
});
