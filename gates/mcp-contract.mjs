/**
 * The ChatGPT plugin's contract, walked against a DEPLOYED /mcp the way ChatGPT walks it.
 *
 *   node gates/mcp-contract.mjs https://scoopdogg-git-<branch>-<team>.vercel.app [--vercel-curl]
 *
 * A protected preview answers 401 to a plain request. `--vercel-curl` sends every request through
 * `vercel curl`, which signs in as the logged-in Vercel user, so no bypass secret is handled here.
 *
 * tests/mcp.test.ts proves the contract on fakes. This proves the deployment: the rewrite reaches
 * api/mcp.ts, the rows load, and the price ChatGPT would quote is the price llms.txt publishes,
 * read independently (a verifier that shares the producer's code agrees with it, wrong and all).
 *
 * READS ONLY. It never calls book_start_day or submit_service_request: production and every
 * preview share one database, and a gate must not leave a booking in Josue's list.
 */
import { execFileSync } from 'node:child_process';
const base = (process.argv[2] || process.env.SD_DEPLOY_URL || '').replace(/\/$/, '');
const viaVercel = process.argv.includes('--vercel-curl');
if (!/^https:\/\/[^/]+\./.test(base)) { console.error('usage: node gates/mcp-contract.mjs <deployment-url>'); process.exit(1); }
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-scoopdogg-verifier': 'gate',
  ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) };
let id = 0, fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++; };
/** GET or POST a path on the deployment, through `vercel curl` when asked. Returns the body text. */
async function get(path, body) {
  if (viaVercel) {
    const args = ['curl', path, '--deployment', base, '--', '-s', '-f'];
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    if (body) args.push('-X', 'POST', '-d', body);
    return execFileSync('vercel', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  }
  const r = await fetch(`${base}${path}`, body ? { method: 'POST', headers, body } : { headers });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.text();
}
async function rpc(method, params) {
  return JSON.parse(await get('/mcp', JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }))).result;
}
const call = (name, args) => rpc('tools/call', { name, arguments: args });

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gate', version: '0' } });
ok(init.serverInfo?.name === 'scoop-dogg', `initialize answers as ${init.serverInfo?.name}`);
const { tools } = await rpc('tools/list');
ok(tools.length === 6, `${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
ok(tools.every((t) => ['readOnlyHint', 'destructiveHint', 'openWorldHint'].every((k) => typeof t.annotations?.[k] === 'boolean')), 'every tool annotated with explicit booleans');
const res = await rpc('resources/read', { uri: 'ui://widget/request-service.html' });
ok(res.contents[0].mimeType === 'text/html;profile=mcp-app', 'booking card served as an MCP App');

ok((await call('check_service_area', { postal_code: '91360' })).structuredContent.served === true, '91360 is served');
ok((await call('check_service_area', { postal_code: '10001' })).structuredContent.served === false, '10001 is not');

const llms = await get('/llms.txt');
const line = llms.split('\n').find((l) => l.startsWith('Monthly plans (weekly visits): 1 dog')) || '';
const two = /2 dogs (\$\d+)\/month/.exec(line)?.[1];
const q = await call('get_price_and_start_days', { postal_code: '93030', dogs: 2 });
ok(two && q.structuredContent.per_month === two, `2 dogs in 93030: ${q.structuredContent.per_month}/month, llms.txt says ${two}`);
ok(Array.isArray(q.structuredContent.start_days) && q.structuredContent.start_days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)), `${q.structuredContent.start_days?.length} open start days, each with a date`);

const everything = JSON.stringify([q, await call('list_services', {}), await call('request_service', { postal_code: '93030' }), res]);
ok(!/\/book\b|checkout|stripe\.com/i.test(everything), 'no checkout link anywhere a ChatGPT user can reach');

console.log(fail ? `\n${fail} FAILED` : '\nmcp-contract: all pass');
process.exit(fail ? 1 : 0);
