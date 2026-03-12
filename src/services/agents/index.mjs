import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const jsonCache = path.join(__dirname, 'prompts.json');

let cachedPrompts = {};

try {
  cachedPrompts = JSON.parse(fs.readFileSync(jsonCache, 'utf-8'));
} catch (error) {
  console.error('Failed to load Python agent prompts from json:', error);
}

export const Prompts = cachedPrompts;
