import { buildApp } from './app';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

const app = buildApp();

app
  .listen({ port, host })
  .then((address) => {
    process.stdout.write(`API listening on ${address}\n`);
  })
  .catch((error: unknown) => {
    process.stderr.write(`API failed to start: ${String(error)}\n`);
    process.exit(1);
  });
