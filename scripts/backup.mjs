import path from 'node:path';
import { config } from '../src/config.mjs';
import { createBackup } from './backup-lib.mjs';

const backupRootDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'backups'));

const result = await createBackup({
  dataDir: config.dataDir,
  backupRootDir,
});

console.log(JSON.stringify({
  ok: true,
  backup_dir: result.backupDir,
  db_tables: result.manifest.db_tables,
  uploads_copied: result.manifest.uploads_copied,
}, null, 2));
