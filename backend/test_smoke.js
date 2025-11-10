// Simple smoke test for backend endpoints
import fetch from 'node-fetch';
const BASE = 'http://localhost:3001';
(async () => {
  try {
    console.log('Checking /api/sneakers...');
    const s = await fetch(`${BASE}/api/sneakers`);
    console.log('/api/sneakers', s.status);
    const list = await s.json();
    console.log('Found', Array.isArray(list) ? list.length : 'no list');

    console.log('Checking /api/purchase with missing data (expect 400)...');
    const p = await fetch(`${BASE}/api/purchase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    console.log('/api/purchase status', p.status);

    console.log('Smoke test done.');
  } catch (err) {
    console.error('Smoke test failed', err);
    process.exit(2);
  }
})();
