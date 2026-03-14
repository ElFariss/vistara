import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../utils/logger.mjs';

const logger = createLogger('python-sandbox');

/**
 * Enhanced Python sandbox for generic dataset analysis using pandas and openpyxl.
 * Runs agent-generated Python code against uploaded data files.
 */
export async function runPythonAnalysis(code, targetFilePath, timeoutMs = 30000) {
  const scriptId = randomUUID();

  try {
    // Resolve absolute paths for Docker boundaries
    const absDataPath = path.resolve(targetFilePath);
    const filename = path.basename(targetFilePath);

    // Get the data directory to mount
    const dataDir = path.dirname(absDataPath);

    logger.info('executing python analysis', {
      scriptId,
      filename,
      codeLength: code.length
    });

    return new Promise((resolve, reject) => {
      const docker = spawn('docker', [
        'run', '-i', '--rm',
        '--network', 'none', // Block internet access
        '--memory', '512m',  // Restrict memory for pandas operations
        '--cpus', '1.0',     // Limit CPU usage
        '--user', 'sandbox', // Run as sandboxed user
        '-v', `${dataDir}:/data:ro`,
        'vistara-python-agent', // The enhanced image name
        'python', '-', `/data/${filename}`
      ]);

      let stdout = '';
      let stderr = '';

      docker.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      docker.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      docker.on('close', (code) => {
        logger.info('python analysis completed', {
          scriptId,
          exitCode: code,
          stdoutLength: stdout.length,
          stderrLength: stderr.length
        });

        if (code === 0) {
          resolve({ success: true, result: stdout.trim() });
        } else {
          const errorMsg = stderr.trim() || `Process exited with code ${code}`;
          logger.warn('python analysis failed', { scriptId, error: errorMsg });
          resolve({ success: false, result: errorMsg });
        }
      });

      docker.on('error', (error) => {
        logger.error('docker execution error', { scriptId, error: error.message });
        resolve({
          success: false,
          result: `Docker execution error: ${error.message}`
        });
      });

      // Enforce physical timeout
      const timer = setTimeout(() => {
        logger.warn('python analysis timeout', { scriptId, timeoutMs });
        docker.kill('SIGKILL');
        resolve({
          success: false,
          result: `Analysis timed out after ${timeoutMs}ms`
        });
      }, timeoutMs);

      docker.on('close', () => {
        clearTimeout(timer);
      });

      // Send the code to python via stdin
      docker.stdin.write(code);
      docker.stdin.end();
    });
  } catch(e) {
    return { success: false, result: e.message };
  }
}

/**
 * Simple wrapper that matches the existing runPythonSnippet interface
 * but delegates to the enhanced analysis function.
 */
export async function runPythonSnippetForDataAnalysis(code, context = {}) {
  if (!context.dataset_path) {
    return {
      success: false,
      result: 'No dataset path provided in context'
    };
  }

  return runPythonAnalysis(code, context.dataset_path);
}

/**
 * Generate a Python script template for common data analysis tasks
 */
export function generateAnalysisTemplate(task, dataInfo = {}) {
  const templates = {
    'inspect_structure': `
# Data structure inspection
import pandas as pd

if target_file.endswith('.xlsx') or target_file.endswith('.xls'):
    # Read all sheets
    excel_data = pd.read_excel(target_file, sheet_name=None)
    print(f"Excel file contains {len(excel_data)} sheets:")

    for sheet_name, df in excel_data.items():
        print(f"\\nSheet '{sheet_name}':")
        print(f"  - Shape: {df.shape}")
        print(f"  - Columns: {list(df.columns)}")
        print(f"  - Data types: {dict(df.dtypes)}")
        print(f"  - Sample rows:")
        print(df.head(3).to_string())
else:
    # CSV file
    df = pd.read_csv(target_file)
    print(f"CSV Data Structure:")
    print(f"  - Shape: {df.shape}")
    print(f"  - Columns: {list(df.columns)}")
    print(f"  - Data types: {dict(df.dtypes)}")
    print(f"  - Sample rows:")
    print(df.head(5).to_string())
`,

    'summary_statistics': `
# Generate summary statistics
import pandas as pd

if target_file.endswith('.xlsx') or target_file.endswith('.xls'):
    df = pd.read_excel(target_file, sheet_name=0)  # First sheet
else:
    df = pd.read_csv(target_file)

print("Summary Statistics:")
print("=" * 50)

# Basic info
print(f"Total rows: {len(df)}")
print(f"Total columns: {len(df.columns)}")

# Numeric columns summary
numeric_cols = df.select_dtypes(include=['number']).columns
if len(numeric_cols) > 0:
    print(f"\\nNumeric columns ({len(numeric_cols)}):")
    print(df[numeric_cols].describe().to_string())

# Text columns summary
text_cols = df.select_dtypes(include=['object']).columns
if len(text_cols) > 0:
    print(f"\\nText columns ({len(text_cols)}):")
    for col in text_cols[:5]:  # Show first 5 text columns
        unique_count = df[col].nunique()
        print(f"  {col}: {unique_count} unique values")
        if unique_count < 10:
            print(f"    Values: {df[col].unique().tolist()}")
`,

    'find_patterns': `
# Pattern analysis for business data
import pandas as pd

if target_file.endswith('.xlsx') or target_file.endswith('.xls'):
    df = pd.read_excel(target_file, sheet_name=0)
else:
    df = pd.read_csv(target_file)

print("Business Data Pattern Analysis:")
print("=" * 50)

# Look for common business columns
business_patterns = {
    'dates': ['date', 'tanggal', 'tgl', 'waktu', 'created', 'updated'],
    'revenue': ['omzet', 'revenue', 'total', 'pendapatan', 'penjualan'],
    'products': ['produk', 'product', 'item', 'barang', 'nama'],
    'quantities': ['qty', 'quantity', 'jumlah', 'kuantitas'],
    'prices': ['harga', 'price', 'cost', 'biaya'],
    'branches': ['cabang', 'branch', 'lokasi', 'toko']
}

found_columns = {}
for pattern_name, keywords in business_patterns.items():
    matches = []
    for col in df.columns:
        col_lower = str(col).lower()
        if any(keyword in col_lower for keyword in keywords):
            matches.append(col)
    if matches:
        found_columns[pattern_name] = matches

print("Detected business data patterns:")
for pattern, columns in found_columns.items():
    print(f"  {pattern.title()}: {columns}")

# Show sample of detected patterns
for pattern, columns in found_columns.items():
    if columns:
        col = columns[0]
        print(f"\\nSample {pattern} data ({col}):")
        sample_values = df[col].dropna().head(5).tolist()
        print(f"  {sample_values}")
`
  };

  return templates.get(task, templates['inspect_structure']);
}