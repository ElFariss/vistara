import fs from 'node:fs/promises';
import path from 'node:path';

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function timestampSlug(input = new Date()) {
  return input.toISOString().replace(/[:]/g, '-').replace(/\..+/, '');
}

function dbSidecarTargets(dbPath) {
  return [
    { kind: 'main', source: dbPath, target: dbPath },
    { kind: 'wal', source: `${dbPath}-wal`, target: `${dbPath}-wal` },
    { kind: 'shm', source: `${dbPath}-shm`, target: `${dbPath}-shm` },
  ];
}

export async function createBackup({
  dataDir,
  dbPath,
  backupRootDir,
  label = 'backup',
  now = new Date(),
} = {}) {
  if (!dataDir || !dbPath || !backupRootDir) {
    throw new Error('dataDir, dbPath, dan backupRootDir wajib diisi.');
  }

  const backupId = `${label}-${timestampSlug(now)}`;
  const backupDir = path.resolve(backupRootDir, backupId);
  const dbDir = path.join(backupDir, 'db');
  const uploadsSourceDir = path.join(dataDir, 'uploads');
  const uploadsTargetDir = path.join(backupDir, 'uploads');

  await fs.mkdir(dbDir, { recursive: true });

  const copiedDbFiles = [];
  for (const file of dbSidecarTargets(dbPath)) {
    if (!(await pathExists(file.source))) {
      continue;
    }
    const backupName = path.basename(file.source);
    await fs.copyFile(file.source, path.join(dbDir, backupName));
    copiedDbFiles.push({ kind: file.kind, filename: backupName });
  }

  const uploadsCopied = await pathExists(uploadsSourceDir);
  if (uploadsCopied) {
    await fs.cp(uploadsSourceDir, uploadsTargetDir, { recursive: true });
  }

  const manifest = {
    label,
    created_at: now.toISOString(),
    data_dir: path.resolve(dataDir),
    db_path: path.resolve(dbPath),
    db_basename: path.basename(dbPath),
    db_files: copiedDbFiles,
    uploads_copied: uploadsCopied,
  };

  await fs.writeFile(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    backupDir,
    manifest,
  };
}

export async function restoreBackup({
  backupDir,
  dataDir,
  dbPath,
} = {}) {
  if (!backupDir || !dataDir || !dbPath) {
    throw new Error('backupDir, dataDir, dan dbPath wajib diisi.');
  }

  const resolvedBackupDir = path.resolve(backupDir);
  const manifestPath = path.join(resolvedBackupDir, 'manifest.json');
  if (!(await pathExists(manifestPath))) {
    throw new Error(`Manifest backup tidak ditemukan di ${resolvedBackupDir}.`);
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const dbDir = path.join(resolvedBackupDir, 'db');
  const uploadsSourceDir = path.join(resolvedBackupDir, 'uploads');
  const uploadsTargetDir = path.join(dataDir, 'uploads');

  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  for (const file of dbSidecarTargets(dbPath)) {
    if (await pathExists(file.target)) {
      await fs.rm(file.target, { force: true });
    }
  }

  if (await pathExists(uploadsTargetDir)) {
    await fs.rm(uploadsTargetDir, { recursive: true, force: true });
  }

  const restoredDbFiles = [];
  for (const file of manifest.db_files || []) {
    const sourcePath = path.join(dbDir, file.filename);
    if (!(await pathExists(sourcePath))) {
      continue;
    }

    const targetPath = file.kind === 'main'
      ? dbPath
      : `${dbPath}-${file.kind}`;
    await fs.copyFile(sourcePath, targetPath);
    restoredDbFiles.push(path.basename(targetPath));
  }

  const restoredUploads = await pathExists(uploadsSourceDir);
  if (restoredUploads) {
    await fs.cp(uploadsSourceDir, uploadsTargetDir, { recursive: true });
  }

  return {
    restoredDbFiles,
    restoredUploads,
    manifest,
  };
}
