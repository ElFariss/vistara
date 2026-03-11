import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.mjs';
import { resolvePublicErrorMessage, sendError, sendJson, sendNoContent } from '../http/response.mjs';
import {
  deleteSource,
  getSource,
  ingestUploadedSource,
  listSources,
  repairLatestSourceIfNeeded,
  updateSourceMapping,
} from '../services/ingestion.mjs';
import { getDatasetProfile, inspectDatasetQuestion } from '../services/dataProfile.mjs';
import { executeBuilderQuery, getBuilderSchema } from '../services/queryEngine.mjs';
import { listDatasetTables, getDatasetTable } from '../services/datasetTables.mjs';
import { safeJsonParse } from '../utils/parse.mjs';
import { generateId } from '../utils/ids.mjs';
import { createLogger } from '../utils/logger.mjs';

const logger = createLogger('data-routes');

function sanitizeFilename(filename) {
  return path
    .basename(filename)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
}

function getUploadedFile(parsedBody) {
  if (!parsedBody || typeof parsedBody !== 'object') {
    return null;
  }

  const files = parsedBody.files || {};
  if (files.file) {
    return files.file;
  }

  const first = Object.values(files)[0];
  return first || null;
}

async function ingestFromStoredFile({ tenantId, userId, storedPath, safeName, contentType }) {
  const ingested = await ingestUploadedSource({
    tenantId,
    userId,
    filePath: storedPath,
    filename: safeName,
    contentType,
    replaceExisting: true,
  });

  return {
    source: ingested.source,
    analysis: ingested.analysis,
    result: ingested.result,
  };
}

function repairErrorMeta(reason) {
  switch (reason) {
    case 'source_not_found':
      return {
        statusCode: 404,
        code: 'SOURCE_NOT_FOUND',
        message: 'Belum ada source data yang bisa diperbaiki.',
      };
    case 'product_columns_not_found':
      return {
        statusCode: 422,
        code: 'REPAIR_NOT_SUPPORTED',
        message: 'Source terbaru tidak punya kolom produk generik yang bisa dipakai untuk repair.',
      };
    case 'product_mapping_missing':
      return {
        statusCode: 422,
        code: 'REPAIR_MAPPING_FAILED',
        message: 'Repair tidak berhasil menemukan mapping produk yang valid.',
      };
    case 'repair_reingest_failed':
      return {
        statusCode: 500,
        code: 'DATASET_REPAIR_FAILED',
        message: 'Repair dataset gagal dijalankan. Dataset lama tetap dipertahankan.',
      };
    default:
      return {
        statusCode: 400,
        code: 'DATASET_REPAIR_FAILED',
        message: 'Repair dataset gagal dijalankan.',
      };
  }
}

function datasetInspectionErrorMeta(error) {
  if (['ENOENT', 'EACCES', 'EPERM', 'EISDIR'].includes(error?.code)) {
    return {
      statusCode: 500,
      code: 'DATASET_INSPECTION_FAILED',
      message: 'File dataset tidak bisa dibaca dari storage server.',
    };
  }

  return {
    statusCode: 400,
    code: 'DATASET_INSPECTION_FAILED',
    message: 'Pertanyaan inspeksi dataset tidak bisa diproses.',
  };
}

function datasetProfileErrorMeta(error) {
  if (['ENOENT', 'EACCES', 'EPERM', 'EISDIR'].includes(error?.code)) {
    return {
      statusCode: 500,
      code: 'DATASET_PROFILE_FAILED',
      message: 'Profil dataset tidak bisa dibaca dari storage server.',
    };
  }

  return {
    statusCode: 500,
    code: 'DATASET_PROFILE_FAILED',
    message: 'Profil dataset tidak bisa diproses saat ini.',
  };
}

export function registerDataRoutes(router) {
  router.register(
    'POST',
    '/api/data/upload',
    async (ctx) => {
      const body = await ctx.getBody();
      const file = getUploadedFile(body);

      if (!file || !file.buffer) {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'File wajib diupload melalui field "file".');
      }

      const safeName = sanitizeFilename(file.filename || 'dataset.csv');
      const tempId = generateId();
      const storedPath = path.join(config.uploadDir, `${tempId}-${safeName}`);

      fs.writeFileSync(storedPath, file.buffer);

      try {
        const ingested = await ingestFromStoredFile({
          tenantId: ctx.user.tenant_id,
          userId: ctx.user.id,
          storedPath,
          safeName,
          contentType: file.contentType,
        });

        return sendJson(ctx.res, 201, {
          ok: true,
          source: ingested.source,
          preview: {
            columns: ingested.analysis.columns,
            sample_rows: ingested.analysis.sampleRows,
            mapping: ingested.analysis.suggestion,
          },
          ingestion: {
            dataset_type: ingested.result.datasetType,
            inserted: ingested.result.inserted,
            duplicates: ingested.result.duplicates,
            skipped: ingested.result.skipped,
          },
        });
      } catch (error) {
        if (fs.existsSync(storedPath)) {
          fs.unlinkSync(storedPath);
        }
        return sendError(
          ctx.res,
          400,
          'UPLOAD_PROCESS_ERROR',
          resolvePublicErrorMessage(error, 'File tidak bisa diproses sebagai dataset.'),
        );
      }
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/data/demo/import',
    async (ctx) => {
      const demoSource = path.resolve(process.cwd(), 'test.csv');
      if (!fs.existsSync(demoSource)) {
        return sendError(ctx.res, 404, 'DEMO_NOT_FOUND', 'File demo test.csv tidak ditemukan.');
      }

      const safeName = 'test.csv';
      const storedPath = path.join(config.uploadDir, `${generateId()}-${safeName}`);
      fs.copyFileSync(demoSource, storedPath);

      try {
        const ingested = await ingestFromStoredFile({
          tenantId: ctx.user.tenant_id,
          userId: ctx.user.id,
          storedPath,
          safeName,
          contentType: 'text/csv',
        });

        return sendJson(ctx.res, 201, {
          ok: true,
          source: ingested.source,
          preview: {
            columns: ingested.analysis.columns,
            sample_rows: ingested.analysis.sampleRows,
            mapping: ingested.analysis.suggestion,
          },
          ingestion: {
            dataset_type: ingested.result.datasetType,
            inserted: ingested.result.inserted,
            duplicates: ingested.result.duplicates,
            skipped: ingested.result.skipped,
          },
          demo: true,
        });
      } catch (error) {
        if (fs.existsSync(storedPath)) {
          fs.unlinkSync(storedPath);
        }
        return sendError(
          ctx.res,
          400,
          'DEMO_IMPORT_FAILED',
          resolvePublicErrorMessage(error, 'Dataset demo tidak bisa diimpor saat ini.'),
        );
      }
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/data/profile',
    async (ctx) => {
      try {
        const profile = await getDatasetProfile(ctx.user.tenant_id);
        if (!profile) {
          return sendError(ctx.res, 404, 'DATASET_PROFILE_NOT_FOUND', 'Belum ada dataset yang bisa diprofilkan.');
        }

        return sendJson(ctx.res, 200, {
          ok: true,
          profile,
        });
      } catch (error) {
        const errorMeta = datasetProfileErrorMeta(error);
        logger.error('dataset_profile_failed', {
          tenant_id: ctx.user.tenant_id,
          code: error?.code || null,
          error: error?.message || 'unknown_error',
        });
        return sendError(ctx.res, errorMeta.statusCode, errorMeta.code, errorMeta.message);
      }
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/data/profile/inspect',
    async (ctx) => {
      const body = await ctx.getBody();

      try {
        const inspection = await inspectDatasetQuestion({
          tenantId: ctx.user.tenant_id,
          message: body?.message || '',
        });

        if (!inspection.profile) {
          return sendError(ctx.res, 404, 'DATASET_PROFILE_NOT_FOUND', 'Belum ada dataset yang bisa diprofilkan.');
        }

        return sendJson(ctx.res, 200, {
          ok: true,
          ...inspection,
        });
      } catch (error) {
        const errorMeta = datasetInspectionErrorMeta(error);
        logger.error('dataset_inspection_failed', {
          tenant_id: ctx.user.tenant_id,
          code: error?.code || null,
          error: error?.message || 'unknown_error',
        });
        return sendError(ctx.res, errorMeta.statusCode, errorMeta.code, errorMeta.message);
      }
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/data/repair',
    async (ctx) => {
      const body = await ctx.getBody();

      try {
        const repair = await repairLatestSourceIfNeeded({
          tenantId: ctx.user.tenant_id,
          userId: ctx.user.id,
          requiredCapability: body?.required_capability || body?.requiredCapability || 'product_dimension',
        });

        if (!repair.ok) {
          const errorMeta = repairErrorMeta(repair.reason);
          return sendError(ctx.res, errorMeta.statusCode, errorMeta.code, errorMeta.message, {
            reason: repair.reason,
            preserved_dataset: Boolean(repair.preserved_dataset),
          });
        }

        return sendJson(ctx.res, 200, {
          ok: true,
          repair,
        });
      } catch (error) {
        return sendError(
          ctx.res,
          500,
          'DATASET_REPAIR_FAILED',
          resolvePublicErrorMessage(error, 'Perbaikan dataset gagal dijalankan.'),
        );
      }
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/data/sources',
    async (ctx) => {
      const sources = listSources(ctx.user.tenant_id).map((source) => ({
        ...source,
        column_mapping: safeJsonParse(source.column_mapping, {}),
      }));
      return sendJson(ctx.res, 200, { ok: true, sources });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/data/sources/:id/mapping',
    async (ctx) => {
      const source = getSource(ctx.user.tenant_id, ctx.params.id);
      if (!source) {
        return sendError(ctx.res, 404, 'SOURCE_NOT_FOUND', 'Data source tidak ditemukan.');
      }

      return sendJson(ctx.res, 200, {
        ok: true,
        source_id: source.id,
        mapping: safeJsonParse(source.column_mapping, {}),
      });
    },
    { auth: true },
  );

  router.register(
    'PUT',
    '/api/data/sources/:id/mapping',
    async (ctx) => {
      const body = await ctx.getBody();
      if (!body.mapping || typeof body.mapping !== 'object') {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'Body harus berisi object mapping.');
      }

      try {
        updateSourceMapping({
          tenantId: ctx.user.tenant_id,
          sourceId: ctx.params.id,
          datasetType: body.dataset_type || body.datasetType || 'transaction',
          mapping: body.mapping,
        });

        return sendJson(ctx.res, 200, {
          ok: true,
          source: getSource(ctx.user.tenant_id, ctx.params.id),
        });
      } catch (error) {
        return sendError(
          ctx.res,
          400,
          'MAPPING_INVALID',
          resolvePublicErrorMessage(error, 'Mapping data tidak valid.'),
        );
      }
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/data/sources/:id/process',
    async (ctx) => {
      return sendError(
        ctx.res,
        410,
        'ENDPOINT_DEPRECATED',
        'Endpoint process sudah deprecated. Upload sekarang langsung parse + ingest sebagai snapshot statis.',
      );
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/data/schema',
    async (ctx) => {
      return sendJson(ctx.res, 200, {
        ok: true,
        schema: getBuilderSchema(ctx.user.tenant_id),
      });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/data/tables',
    async (ctx) => {
      const tables = listDatasetTables(ctx.user.tenant_id).map((table) => ({
        id: table.id,
        name: table.name,
        row_count: table.row_count,
        columns: table.columns,
        profile: table.profile,
        description: table.profile?.columns?.length
          ? `${table.row_count} baris • ${table.profile.columns.length} kolom`
          : `${table.row_count} baris`,
      }));
      return sendJson(ctx.res, 200, { ok: true, tables });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/data/tables/:id/preview',
    async (ctx) => {
      const table = getDatasetTable(ctx.user.tenant_id, ctx.params.id);
      if (!table) {
        return sendError(ctx.res, 404, 'DATASET_TABLE_NOT_FOUND', 'Dataset table tidak ditemukan.');
      }
      const limit = Number.parseInt(String(ctx.query.get('limit') || '5'), 10);
      const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 25) : 5;
      const rows = Array.isArray(table.rows) ? table.rows.slice(0, safeLimit) : [];
      return sendJson(ctx.res, 200, {
        ok: true,
        id: table.id,
        name: table.name,
        columns: table.columns,
        rows,
        row_count: table.row_count,
      });
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/data/query',
    async (ctx) => {
      const body = await ctx.getBody();
      try {
        const result = executeBuilderQuery({
          tenantId: ctx.user.tenant_id,
          userId: ctx.user.id,
          query: body || {},
        });
        return sendJson(ctx.res, 200, {
          ok: true,
          ...result,
        });
      } catch (error) {
        return sendError(
          ctx.res,
          400,
          'QUERY_FAILED',
          resolvePublicErrorMessage(error, 'Query builder tidak bisa diproses.'),
        );
      }
    },
    { auth: true },
  );

  router.register(
    'DELETE',
    '/api/data/sources/:id',
    async (ctx) => {
      const deleted = deleteSource(ctx.user.tenant_id, ctx.params.id);
      if (!deleted) {
        return sendError(ctx.res, 404, 'SOURCE_NOT_FOUND', 'Data source tidak ditemukan.');
      }
      return sendNoContent(ctx.res);
    },
    { auth: true },
  );
}
