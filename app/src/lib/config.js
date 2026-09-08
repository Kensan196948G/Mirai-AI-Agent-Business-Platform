import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv(join(__dirname, '..', '..', '.env'));

export const SESSION_SECRET = process.env.SESSION_SECRET;
export const PORT = Number(process.env.PORT || 18860);
export const IS_PROD = process.env.NODE_ENV === 'production';
export const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

if (!SESSION_SECRET || SESSION_SECRET === 'CHANGE_ME') {
  throw new Error('SESSION_SECRET が未設定、または既定値のまま。.env を設定すること');
}
