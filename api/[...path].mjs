/**
 * 星屿乐园 Vercel API：浏览器只打 /api，Vectoree 密钥留在环境变量里。
 */
import { handleApi } from '../lib/park-api.mjs';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    await handleApi(req, res, url);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: err.message || 'server error' }));
    }
  }
}
