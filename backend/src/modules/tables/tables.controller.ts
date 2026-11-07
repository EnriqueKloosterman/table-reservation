import type { RouteContext, RouteHandler } from "../../shared/openapi/route.js";
import type {
  CreateTableSchema,
  TableIdParamsSchema,
  UpdateTableSchema,
} from "./tables.schemas.js";
import { createTable, getTable, listTables, removeTable, updateTable } from "./tables.service.js";

type IdParams = typeof TableIdParamsSchema;

export type TablesController = {
  create: RouteHandler<undefined, undefined, typeof CreateTableSchema>;
  list: RouteHandler<undefined, undefined, undefined>;
  get: RouteHandler<IdParams, undefined, undefined>;
  update: RouteHandler<IdParams, undefined, typeof UpdateTableSchema>;
  remove: RouteHandler<IdParams, undefined, undefined>;
};

/** HTTP handlers for tables: read the validated input, call the service, shape the response. */
export function createTablesController({ clock }: Pick<RouteContext, "clock">): TablesController {
  return {
    create: async (_req, res) => {
      const table = await createTable(res.locals.input.body);
      res.status(201).location(`/tables/${table.id}`).json(table);
    },

    list: async (_req, res) => {
      res.json(await listTables());
    },

    get: async (_req, res) => {
      res.json(await getTable(res.locals.input.params.id));
    },

    update: async (_req, res) => {
      const { params, body } = res.locals.input;
      res.json(await updateTable(params.id, body, { clock }));
    },

    remove: async (_req, res) => {
      await removeTable(res.locals.input.params.id, { clock });
      res.status(204).end();
    },
  };
}
