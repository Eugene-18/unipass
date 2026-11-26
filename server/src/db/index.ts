import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

// 確保環境變數有讀到
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('⚠️ 找不到 DATABASE_URL，請確認 .env 檔案設定是否正確');
}

// 正式環境（Neon）使用 Serverless HTTP 連線；
// 本機開發若使用一般 PostgreSQL（例如 localhost），改用 node-postgres 連線池。
function isNeonDatabase(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.neon.tech');
  } catch {
    return false;
  }
}

// 匯出 db 實例供整個專案使用，並載入 schema 讓 Drizzle 知道資料表結構。
// 兩種連線方式的查詢 API 相同，型別以 Neon 版本為準。
export const db = isNeonDatabase(databaseUrl)
  ? drizzleNeon(neon(databaseUrl), { schema })
  : (drizzlePg(new Pool({ connectionString: databaseUrl }), { schema }) as unknown as ReturnType<typeof drizzleNeon<typeof schema>>);
