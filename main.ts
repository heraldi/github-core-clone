// Entry lifecycle: bind a free port, register it with the env, and stay alive until the trial ends.
import { createApp } from './app.ts';

const origin = (process.env.MAKEFUN_ENV_URL ?? '').replace(/\/+$/, '');
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const timeout = 30_000;

async function request(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {...init, signal: AbortSignal.timeout(timeout)});
}

async function register(port: number): Promise<void> {
  let wait = 250;
  for (;;) {
    try {
      const response = await request(`${origin}/register`, {
        method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({port}),
      });
      if (response.status === 200 || response.status === 409) return;
      if (response.status === 400 || response.status === 405) throw new Error(`register rejected: HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('register rejected:')) throw error;
    }
    await pause(wait); wait = Math.min(wait * 2, 2000);
  }
}

async function waitUntilDone(): Promise<void> {
  let wait = 250;
  for (;;) {
    try {
      const response = await request(`${origin}/done`);
      if (response.ok && (await response.json() as {done?: unknown}).done === true) return;
    } catch { /* A temporary poll failure is not the end of the trial. */ }
    await pause(wait); wait = Math.min(wait * 2, 2000);
  }
}

async function main(): Promise<void> {
  if (!origin) throw new Error('MAKEFUN_ENV_URL is not set');
  const server = createApp();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind a TCP port');
  await register(address.port);
  await waitUntilDone();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

try {
  await main();
  process.exit(0);
} catch (error) {
  process.stderr.write(`[entry] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
