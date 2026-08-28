import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hashObject } from '../crypto.mjs';
import { ShippingError, invariant } from '../errors.mjs';
import { appendJsonLine, exists } from '../fs.mjs';
import { goalRuntimePaths } from './paths.mjs';

/** @param {Record<string, any>} event */
function eventForHash(event) {
  const { eventHash: _ignored, ...rest } = event;
  return rest;
}

/**
 * @param {string} root
 * @param {{allowTruncatedTail?: boolean}} [options]
 */
export async function readExecutionLedger(root, options = {}) {
  const ledgerPath = goalRuntimePaths(root).ledger;
  if (!(await exists(ledgerPath))) return { events: [], diagnostics: [] };
  const text = await readFile(ledgerPath, 'utf8');
  const rawLines = text.split(/\r?\n/u);
  const diagnostics = [];
  const events = [];
  const lastContentIndex = rawLines.reduce((last, line, index) => line.length > 0 ? index : last, -1);

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      const isTail = index === lastContentIndex && !text.endsWith('\n');
      if (isTail && options.allowTruncatedTail === true) {
        diagnostics.push({
          code: 'TRUNCATED_TAIL_IGNORED',
          line: index + 1,
          message: `Ignored a truncated final execution-ledger line at ${index + 1}.`,
        });
        break;
      }
      throw new ShippingError('ERR_GOAL_LEDGER_CORRUPT', `Invalid Goal execution ledger JSON at line ${index + 1}`, {
        filePath: ledgerPath,
        line: index + 1,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let previousHash = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    invariant(event?.schema === 'shipping-harness/goal-event-v1', 'ERR_GOAL_LEDGER_CORRUPT', `Unsupported Goal ledger event schema at line ${index + 1}`);
    invariant(event.seq === index + 1, 'ERR_GOAL_LEDGER_CORRUPT', `Goal ledger sequence mismatch at line ${index + 1}`, { expected: index + 1, actual: event.seq });
    invariant(event.previousHash === previousHash, 'ERR_GOAL_LEDGER_CORRUPT', `Goal ledger hash-chain mismatch at line ${index + 1}`);
    invariant(event.eventHash === hashObject(eventForHash(event)), 'ERR_GOAL_LEDGER_CORRUPT', `Goal ledger event hash mismatch at line ${index + 1}`);
    previousHash = event.eventHash;
  }
  return { events, diagnostics };
}

/**
 * @param {string} root
 * @param {{type: string, release: string, contractHash: string, graphHash: string, entityType?: string, entityId?: string, payload?: unknown, at?: string, eventId?: string}} input
 */
export async function appendExecutionEvent(root, input) {
  const { events } = await readExecutionLedger(root, { allowTruncatedTail: false });
  const previous = events.at(-1) ?? null;
  const event = {
    schema: 'shipping-harness/goal-event-v1',
    seq: events.length + 1,
    eventId: input.eventId ?? randomUUID(),
    at: input.at ?? new Date().toISOString(),
    type: input.type,
    release: input.release,
    contractHash: input.contractHash,
    graphHash: input.graphHash,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    payload: input.payload ?? null,
    previousHash: previous?.eventHash ?? null,
  };
  event.eventHash = hashObject(event);
  await appendJsonLine(goalRuntimePaths(root).ledger, event);
  return event;
}
