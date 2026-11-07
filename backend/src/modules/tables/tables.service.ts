import { Types } from "mongoose";
import type { Clock } from "../../shared/clock.js";
import { AppError, conflict, notFound } from "../../shared/errors/app-error.js";
import { nameKey } from "../../shared/validation/normalize.js";
import { affectedByCapacity } from "../reservations/affected.js";
import { TableDay } from "../reservations/calendar.model.js";
import { Table } from "./table.model.js";
import type {
  CreateTableInput,
  TableDto,
  UpdatedTableDto,
  UpdateTableInput,
} from "./tables.schemas.js";

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const NUMERIC_COLLATION = { locale: "en", numericOrdering: true };

type TableDoc = { _id: Types.ObjectId; name: string; capacity: number };

function toTable(doc: TableDoc): TableDto {
  return { id: doc._id.toHexString(), name: doc.name, capacity: doc.capacity };
}

const tableNotFound = () => notFound("Table not found");

/** A malformed id cannot exist, so it is reported as NOT_FOUND like an unknown id. */
export function parseTableId(id: string): Types.ObjectId {
  if (!OBJECT_ID.test(id)) throw tableNotFound();
  return new Types.ObjectId(id);
}

function rethrowDuplicate(err: unknown): never {
  if ((err as { code?: unknown }).code === 11000) {
    throw conflict("A table with this name already exists");
  }
  throw err;
}

export async function createTable({ name, capacity }: CreateTableInput): Promise<TableDto> {
  try {
    const doc = await Table.create({ name, nameKey: nameKey(name), capacity });
    return toTable(doc);
  } catch (err) {
    rethrowDuplicate(err);
  }
}

export async function listTables(): Promise<TableDto[]> {
  const docs = await Table.find({ removed: false })
    .collation(NUMERIC_COLLATION)
    .sort({ nameKey: 1 })
    .lean();
  return docs.map(toTable);
}

export async function getTable(id: string): Promise<TableDto> {
  const doc = await Table.findOne({ _id: parseTableId(id), removed: false }).lean();
  if (!doc) throw tableNotFound();
  return toTable(doc);
}

export async function updateTable(
  id: string,
  input: UpdateTableInput,
  { clock }: { clock: Clock },
): Promise<UpdatedTableDto> {
  const _id = parseTableId(id);
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) Object.assign(set, { name: input.name, nameKey: nameKey(input.name) });
  if (input.capacity !== undefined) set.capacity = input.capacity;

  let doc: TableDoc | null;
  try {
    doc = await Table.findOneAndUpdate(
      { _id, removed: false },
      { $set: set },
      { returnDocument: "after", runValidators: true },
    ).lean();
  } catch (err) {
    rethrowDuplicate(err);
  }
  if (!doc) throw tableNotFound();
  // Informational (FR-022): only a capacity in the body can contradict a reservation.
  const affectedReservations =
    input.capacity === undefined ? [] : await affectedByCapacity(_id, input.capacity, clock.now());
  return { ...toTable(doc), affectedReservations };
}

const hasUpcomingHolds = async (tableId: Types.ObjectId, now: Date): Promise<boolean> =>
  // Strictly later than now: an interval ending exactly now has ended (FR-017).
  (await TableDay.exists({ tableId, "intervals.end": { $gt: now } })) !== null;

const upcomingReservationsConflict = () =>
  conflict("The table has reservations that have not ended", {
    reason: "table_has_upcoming_reservations",
  });

/** Puts the table back after a lost race: one retry, then an internal error (FR-029). */
async function restoreTable(tableId: Types.ObjectId): Promise<void> {
  const restore = () => Table.updateOne({ _id: tableId }, { $set: { removed: false, removedAt: null } });
  try {
    await restore();
    return;
  } catch {
    // retried once below
  }
  try {
    await restore();
  } catch (err) {
    console.error("Could not restore a table after a refused removal:", err);
    throw new AppError("INTERNAL_ERROR", "An unexpected error occurred");
  }
}

/**
 * Soft delete (research R10). Refused with 409 while the table holds a reservation, or any
 * interval, that has not ended. The normal refusal never touches the table; only when a
 * reservation races the removal is the table briefly removed and then restored.
 */
export async function removeTable(id: string, { clock }: { clock: Clock }): Promise<void> {
  const _id = parseTableId(id);
  const now = clock.now();

  if ((await Table.exists({ _id, removed: false })) === null) throw tableNotFound();
  if (await hasUpcomingHolds(_id, now)) throw upcomingReservationsConflict();

  const removed = await Table.findOneAndUpdate(
    { _id, removed: false },
    { $set: { removed: true, removedAt: now } },
  ).lean();
  if (!removed) throw tableNotFound();

  // A reservation may have claimed the table between the pre-check and the write.
  if (await hasUpcomingHolds(_id, now)) {
    await restoreTable(_id);
    throw upcomingReservationsConflict();
  }
}
