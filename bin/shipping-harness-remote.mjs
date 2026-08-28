#!/usr/bin/env node
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  createInternalHttpsServer,
  InternalRemoteGateway,
  NotificationStore,
  ReplayStore,
  ShippingRemoteAdapter,
  validateRemoteConfig,
} from '../packages/internal-remote/index.mjs';

const HELP = `Shipping Harness Internal Remote Gateway\n\nUsage:\n  shipping-harness-remote --config FILE --cert FILE --key FILE [options]\n\nRequired:\n  --config FILE       Private JSON configuration; credentials are resolved from named environment variables.\n  --cert FILE         TLS certificate PEM.\n  --key FILE          TLS private key PEM.\n\nOptions:\n  --state-root DIR    Durable replay, notification, and backup state root. Default: .shipping-remote\n  --host ADDRESS      Loopback or RFC1918 private IPv4 address. Default: 127.0.0.1\n  --port NUMBER       HTTPS port. Default: 9443\n  --help              Show this help.\n\nThe gateway is internal-only and exposes no arbitrary shell, command, deployment, push, or public tenant surface.\n`;

function parse(argv) {
  const allowed = new Set(['config', 'cert', 'key', 'state-root', 'host', 'port']);
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') return { help: true, options };
    if (!value.startsWith('--')) throw new Error(`Unexpected positional argument: ${value}`);
    const name = value.slice(2);
    if (!allowed.has(name)) throw new Error(`Unsupported option: --${name}`);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`--${name} requires a value`);
    if (options.has(name)) throw new Error(`--${name} may be supplied only once`);
    options.set(name, next);
    index += 1;
  }
  return { help: false, options };
}

function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function portNumber(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer between 0 and 65535');
  return port;
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parse(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }

  const configPath = path.resolve(required(parsed.options, 'config'));
  const certPath = path.resolve(required(parsed.options, 'cert'));
  const keyPath = path.resolve(required(parsed.options, 'key'));
  const raw = JSON.parse(await readFile(configPath, 'utf8'));
  const config = validateRemoteConfig(raw);
  const stateRoot = path.resolve(parsed.options.get('state-root') ?? '.shipping-remote');
  const host = parsed.options.get('host') ?? '127.0.0.1';
  const port = portNumber(parsed.options.get('port') ?? '9443');

  const adapter = new ShippingRemoteAdapter(config.projects);
  const notifications = new NotificationStore(path.join(stateRoot, 'notifications.jsonl'), {
    maxEntries: config.notificationLimit,
  });
  const replayStore = new ReplayStore(path.join(stateRoot, 'replay.json'), {
    ttlMs: config.replayTtlMs,
  });
  const gateway = new InternalRemoteGateway({
    config,
    replayStore,
    adapter,
    notifications,
    backupRoot: path.join(stateRoot, 'backups'),
  });
  const running = await createInternalHttpsServer({
    gateway,
    host,
    port,
    certPath,
    keyPath,
    maxBodyBytes: config.maxBodyBytes,
    maxConcurrent: config.maxConcurrent,
  });
  const selectedPort = typeof running.address === 'object' ? running.address.port : port;
  process.stderr.write(`shipping-harness-remote listening on https://${host}:${selectedPort} (internal only)\n`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await running.close();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      stop().then(() => { process.exitCode = 0; }).catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
      });
    });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
