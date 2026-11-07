import { defineRoute, type RouteContext } from "../../shared/openapi/route.js";
import { z } from "../../shared/openapi/zod.js";
import {
  CREATE_TABLE_EXAMPLE,
  CreateTableSchema,
  TableIdParamsSchema,
  TableSchema,
  UPDATE_TABLE_EXAMPLE,
  UpdateTableSchema,
} from "./tables.schemas.js";
import { createTablesController } from "./tables.controller.js";

const TAGS = ["Tables"];
const ID_NOTE = "A malformed id answers 404 NOT_FOUND, the same as an unknown or removed id.";

export function registerTableRoutes(ctx: RouteContext): void {
  const controller = createTablesController(ctx);

  defineRoute(ctx, {
    method: "post",
    path: "/tables",
    summary: "Create a table",
    description:
      "Creates a table. The name is stored trimmed with its case kept, and must not match an " +
      "active table's name ignoring case and surrounding spaces (409 CONFLICT). The response " +
      "has a `Location: /tables/{id}` header.",
    tags: TAGS,
    auth: true,
    request: { body: { schema: CreateTableSchema, example: CREATE_TABLE_EXAMPLE } },
    success: {
      status: 201,
      description: "The created table.",
      schema: TableSchema,
      headers: z.object({
        Location: z.string().openapi({ description: "URL of the new table, `/tables/{id}`." }),
      }),
    },
    errors: ["VALIDATION_ERROR", "CONFLICT"],
    handler: controller.create,
  });

  defineRoute(ctx, {
    method: "get",
    path: "/tables",
    summary: "List tables",
    description:
      "Lists active tables ordered by name, ignoring case, with digit runs compared as numbers " +
      "(T2 before T10), English collation. Removed tables are not listed.",
    tags: TAGS,
    auth: true,
    success: { status: 200, description: "Active tables.", schema: z.array(TableSchema) },
    errors: [],
    handler: controller.list,
  });

  defineRoute(ctx, {
    method: "get",
    path: "/tables/:id",
    summary: "Get a table",
    description: `Returns one active table. ${ID_NOTE}`,
    tags: TAGS,
    auth: true,
    request: { params: TableIdParamsSchema },
    success: { status: 200, description: "The table.", schema: TableSchema },
    errors: ["NOT_FOUND"],
    handler: controller.get,
  });

  defineRoute(ctx, {
    method: "patch",
    path: "/tables/:id",
    summary: "Update a table",
    description:
      "Changes the name and/or capacity of an active table (at least one field). Resubmitting " +
      "the table's own name with different case or spaces is not a conflict. A refused update " +
      `leaves the table unchanged. ${ID_NOTE}`,
    tags: TAGS,
    auth: true,
    request: {
      params: TableIdParamsSchema,
      body: { schema: UpdateTableSchema, example: UPDATE_TABLE_EXAMPLE },
    },
    success: { status: 200, description: "The updated table.", schema: TableSchema },
    errors: ["VALIDATION_ERROR", "NOT_FOUND", "CONFLICT"],
    handler: controller.update,
  });

  defineRoute(ctx, {
    method: "delete",
    path: "/tables/:id",
    summary: "Remove a table",
    description:
      "Soft-deletes an active table; its name becomes reusable and its id answers 404 from " +
      `then on. ${ID_NOTE} Documented rule (FR-011): once reservations exist (feature 002), ` +
      "removing a table with future reservations will return 409 CONFLICT; not enforced in " +
      "this feature.",
    tags: TAGS,
    auth: true,
    request: { params: TableIdParamsSchema },
    success: { status: 204, description: "Removed. No body." },
    errors: ["NOT_FOUND"],
    handler: controller.remove,
  });
}
