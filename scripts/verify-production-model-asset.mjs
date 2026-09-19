#!/usr/bin/env node

/**
 * Root forwarding entry point for verify-production-model-asset.mjs
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptPath = path.resolve(__dirname, '../apps/customer-web/scripts/verify-production-model-asset.mjs');

await import(pathToFileURL(scriptPath).href);
