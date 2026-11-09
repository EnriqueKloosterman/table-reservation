import type { Types } from "mongoose";

export type ClaimedInterval = { reservationId: Types.ObjectId; start: Date; end: Date };

type UpdateResult = { matchedCount: number; upsertedCount: number };

/** The slice of a Mongoose model the claims need (also satisfied by test stubs). */
export type ClaimModel = {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): PromiseLike<UpdateResult>;
};

const DUPLICATE_KEY = 11000;

const isDuplicateKey = (err: unknown) => (err as { code?: unknown } | null)?.code === DUPLICATE_KEY;

/**
 * Atomically claims `[start, end)` in the calendar document identified by `key`
 * (`{ tableId, date }` or `{ email, date }`). A single-document update is atomic, so the
 * overlap check and the push cannot interleave with another claim (research R5).
 *
 * Returns `true` when claimed, `false` on overlap. Any database error other than a
 * duplicate key is rethrown: it is never reported as an overlap (FR-027c).
 */
export async function claimInterval(
  model: ClaimModel,
  key: Record<string, unknown>,
  { reservationId, start, end }: ClaimedInterval,
): Promise<boolean> {
  const filter = {
    ...key,
    intervals: { $not: { $elemMatch: { start: { $lt: end }, end: { $gt: start } } } },
  };
  const update = { $push: { intervals: { reservationId, start, end } } };
  try {
    const result = await model.updateOne(filter, update, { upsert: true });
    return result.matchedCount === 1 || result.upsertedCount === 1;
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
  // 11000: the document exists (a concurrent creation, or an overlap made the upsert try a
  // second insert). Calendar documents are never deleted, so one retry without upsert suffices.
  const retry = await model.updateOne(filter, update);
  return retry.matchedCount === 1;
}

/** Removes only the interval carrying the caller's own `reservationId`. */
export async function releaseInterval(
  model: ClaimModel,
  key: Record<string, unknown>,
  reservationId: Types.ObjectId,
): Promise<void> {
  await model.updateOne(key, { $pull: { intervals: { reservationId } } });
}
