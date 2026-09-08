import { readFileSync, existsSync } from 'node:fs';

/**
 * .env を最小実装で読み込む（dotenv 依存を追加しないため）。
 * systemd 本番運用では EnvironmentFile= が同じ書式を直接読むので、ここでのパースは
 * ローカル開発時のみ使われる。既に設定済みの環境変数は上書きしない。
 */
export function loadEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
