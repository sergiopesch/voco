/** Canonical preprocessing coverage metadata. Does not read, alter or prepare PCM. */
import {resampledSampleCount} from './sampleGeometry';
export type Identity = Readonly<{ sessionId: number; generation: number }>;
export type Block = Readonly<{
  sourceStart: number; sourceEnd: number;
  preparedStart: number; preparedEnd: number;
  final: boolean;
}>;
export type Ledger = Readonly<{
  identity: Identity; sourceRate: number; blocks: readonly Block[];
}>;
function count(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw Error('Invalid sample count');
}
function active(ledger: Ledger, identity: Identity): void {
  if (ledger.identity.sessionId !== identity.sessionId ||
      ledger.identity.generation !== identity.generation) throw Error('Stale ledger identity');
}
export function createLedger(identity: Identity, sourceRate: number): Ledger {
  count(identity.sessionId); count(identity.generation);
  if (!identity.sessionId || !Number.isFinite(sourceRate) || sourceRate <= 0)
    throw Error('Invalid session/rate');
  return Object.freeze({ identity: Object.freeze({...identity}), sourceRate,
    blocks: Object.freeze([]) });
}
/** Call only after existing recordCanonicalSourceBlock accepted the actual output length. */
function appendPreparedBlock(ledger: Ledger, identity: Identity,
  sourceStart: number, sourceEnd: number, preparedSamples: number, final: boolean): Ledger {
  active(ledger, identity);
  [sourceStart, sourceEnd, preparedSamples].forEach(count);
  if (typeof final !== 'boolean') throw Error('Invalid final flag');
  const prior = ledger.blocks[ledger.blocks.length - 1];
  const index = ledger.blocks.length;
  const expectedStart = Math.round((index === 0 ? 0 : 30 + (index - 1) * 29) * ledger.sourceRate);
  const completeEnd = Math.round((30 + index * 29) * ledger.sourceRate);
  if (prior?.final || sourceStart !== (prior?.sourceEnd ?? 0) || sourceStart !== expectedStart ||
      sourceEnd <= sourceStart || preparedSamples === 0 ||
      (final ? sourceEnd >= completeEnd : sourceEnd !== completeEnd))
    throw Error('Invalid source block sequence');
  // Match the existing complete-block contract, including its refusal of unexpected resampler lengths.
  if (!final && preparedSamples !== (index === 0 ? 480000 : 464000))
    throw Error('Unexpected complete prepared length');
  const actualExpected = resampledSampleCount(sourceEnd - sourceStart, ledger.sourceRate);
  if (preparedSamples !== actualExpected) throw Error('Prepared length differs from existing resampler');
  const preparedStart = prior?.preparedEnd ?? 0;
  const preparedEnd = preparedStart + preparedSamples; count(preparedEnd);
  const block = Object.freeze({sourceStart, sourceEnd, preparedStart, preparedEnd, final});
  return Object.freeze({...ledger, blocks: Object.freeze([...ledger.blocks, block])});
}
/** Nominal coordinate coverage, not a guarantee about a browser resampling filter's support.
 * Interior mapping uses the observed per-block ratio with exact integer floor. Since the
 * unchanged resampler ceils its output length, this does not advance beyond nominal time.
 * Exact block endpoints return exact source endpoints; no accumulated rounding drift.
 */
export function rawPreviewAnchor(ledger: Ledger, identity: Identity,
  previousDecodedEnd: number, nextInputStart: number): number {
  active(ledger, identity); count(previousDecodedEnd); count(nextInputStart);
  const overlap = previousDecodedEnd - nextInputStart;
  if (overlap !== 0 && overlap !== 16000) throw Error('Invalid next decode overlap');
  const end = ledger.blocks[ledger.blocks.length - 1]?.preparedEnd ?? 0;
  if (previousDecodedEnd > end) throw Error('Decoded end beyond prepared cache');
  if (previousDecodedEnd === 0) return 0;
  for (const block of ledger.blocks) {
    if (previousDecodedEnd > block.preparedEnd) continue;
    if (previousDecodedEnd === block.preparedEnd) return block.sourceEnd;
    const offset = BigInt(previousDecodedEnd - block.preparedStart);
    const sourceCount = BigInt(block.sourceEnd - block.sourceStart);
    const preparedCount = BigInt(block.preparedEnd - block.preparedStart);
    return block.sourceStart + Number(offset * sourceCount / preparedCount);
  }
  throw Error('Missing prepared coverage');
}

/** Capture this token before copying/preparing PCM and before any await. */
const preparationBrand: unique symbol = Symbol("canonical-preparation");
export type PreparationTicket = Readonly<{
  [preparationBrand]: true;
  ledger: Ledger;
  sourceStart: number;
  sourceEnd: number;
  final: boolean;
}>;
export function beginPreparation(ledger: Ledger, sourceStart: number,
  sourceEnd: number, final: boolean): PreparationTicket {
  [sourceStart, sourceEnd].forEach(count);
  if (sourceEnd <= sourceStart) throw Error('Empty source block');
  // Validate the current unchanged profile's geometry before asynchronous work.
  const expected = resampledSampleCount(sourceEnd - sourceStart, ledger.sourceRate);
  appendPreparedBlock(ledger, ledger.identity, sourceStart, sourceEnd, expected, final);
  return Object.freeze({[preparationBrand]: true as const, ledger,
    sourceStart, sourceEnd, final});
}
/** Pass the CURRENT ledger, never the ticket's old ledger, after the await.
 * No PCM or cache mutation should occur until this succeeds. Concurrent or
 * duplicate completions are rejected even when they share a session identity.
 */
export function completePreparation(current: Ledger, ticket: PreparationTicket,
  preparedSamples: number): Ledger {
  if (ticket[preparationBrand] !== true || current !== ticket.ledger)
    throw Error('Preparation belongs to a replaced or advanced ledger');
  return appendPreparedBlock(current, ticket.ledger.identity,
    ticket.sourceStart, ticket.sourceEnd, preparedSamples, ticket.final);
}
/** The pending/session module owns generation allocation. Every actual clear
 * or drain of canonical PCM must supply its new identity here synchronously.
 * Output cancellation without a cache clear must not call this function.
 */
export function replaceAfterCacheClear(current: Ledger, nextIdentity: Identity): Ledger {
  if (current.identity.sessionId === nextIdentity.sessionId &&
      nextIdentity.generation <= current.identity.generation)
    throw Error('Cache clear requires a newer generation');
  return createLedger(nextIdentity, current.sourceRate);
}
