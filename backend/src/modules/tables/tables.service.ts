import { Types } from "mongoose";
import type { Clock } from "../../shared/clock.js";
import { conflict, notFound } from "../../shared/errors/app-error.js";
import { nameKey } from "../../shared/validation/normalize.js";
import { Table } from "./table.model.js";
import type { CreateTableInput, TableDto, UpdateTableInput } from "./tables.schemas.js";

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

export async function updateTable(id: string, input: UpdateTableInput): Promise<TableDto> {
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
  return toTable(doc);
}

/**
 * Soft delete. FR-011 (refuse while future reservations exist) is enforced in feature 002.
 */
export async function removeTable(id: string, { clock }: { clock: Clock }): Promise<void> {
  const doc = await Table.findOneAndUpdate(
    { _id: parseTableId(id), removed: false },
    { $set: { removed: true, removedAt: clock.now() } },
  ).lean();
  if (!doc) throw tableNotFound();
}
