import { z } from "../../shared/openapi/zod.js";

/** The id format is checked in the service: a malformed id is a 404, not a 400. */
export const TableIdParamsSchema = z.strictObject({
  id: z.string().openapi({ description: "Table id (24 hex characters).", example: "6740c0ffee0123456789abcd" }),
});

const name = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .openapi({ description: "1–50 characters after trimming; unique among active tables, ignoring case." });
const capacity = z.number().int().min(1).max(50).openapi({ description: "Seats, integer 1–50." });

export const CreateTableSchema = z.strictObject({ name, capacity }).openapi("CreateTable");
export const CREATE_TABLE_EXAMPLE = { name: "T1", capacity: 4 };

export const UpdateTableSchema = z
  .strictObject({ name: name.optional(), capacity: capacity.optional() })
  .refine((body) => body.name !== undefined || body.capacity !== undefined, {
    message: "At least one of name or capacity is required",
    path: [],
  })
  .openapi("UpdateTable", { description: "Partial update; at least one field is required." });
export const UPDATE_TABLE_EXAMPLE = { capacity: 6 };

export const TableSchema = z
  .strictObject({
    id: z.string().openapi({ example: "6740c0ffee0123456789abcd" }),
    name: z.string().openapi({ example: "T1" }),
    capacity: z.number().int().openapi({ example: 4 }),
  })
  .openapi("Table");

export type CreateTableInput = z.output<typeof CreateTableSchema>;
export type UpdateTableInput = z.output<typeof UpdateTableSchema>;
export type TableDto = z.output<typeof TableSchema>;
