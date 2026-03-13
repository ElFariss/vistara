import path from 'node:path';
import { config } from '../src/config.mjs';
import { createBackup, restoreBackup } from './backup-lib.mjs';

const args = process.argv.slice(2);
const yesFlag = args.includes('--yes');
const backupArg = args.find((arg) => !arg.startsWith('--'));

if (!yesFlag || !backupArg) {
  console.error('Usage: npm run restore -- --yes <backup-dir>');
  process.exit(1);
}

const backupRootDir = path.resolve(path.join(process.cwd(), 'backups'));
const safetyBackup = await createBackup({
  dataDir: config.dataDir,
  backupRootDir,
  label: 'pre-restore',
});

const result = await restoreBackup({
  backupDir: backupArg,
  dataDir: config.dataDir,
});

console.log(JSON.stringify({
  ok: true,
  restored_from: path.resolve(backupArg),
  pre_restore_backup: safetyBackup.backupDir,
  restored_tables: result.restoredTables,
  restored_uploads: result.restoredUploads,
}, null, 2));
