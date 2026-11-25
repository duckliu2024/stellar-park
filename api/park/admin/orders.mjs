import { handleApi } from '../../../lib/park-api.mjs';

export default async function handler(req, res) {
  try {
    const incoming = new URL(req.url || '/', 'http://localhost');
    const url = new URL('/api/park/admin/orders', 'http://localhost');
    url.search = incoming.search;
    await handleApi(req, res, url);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: err.message || 'server error' }));
    }
  }
}
