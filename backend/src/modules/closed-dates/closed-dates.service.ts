import type { Config } from "../../config/env.js";
import type { Clock } from "../../shared/clock.js";
import { conflict, notFound, validationError } from "../../shared/errors/app-error.js";
import { ClosedDate } from "./closed-date.model.js";
import { todayInTimeZone } from "./closed-dates.domain.js";
import type {
  ClosedDateDto,
  CreateClosedDateInput,
  ListClosedDatesQuery,
} from "./closed-dates.schemas.js";

type Deps = { config: Config; clock: Clock };

function restaurantToday({ config, clock }: Deps): string {
  return todayInTimeZone(config.RESTAURANT_TIME_ZONE, clock.now());
}

/** `YYYY-MM-DD` sorts as text in date order, so "past" is a plain string comparison. */
export async function createClosedDate(
  { date, reason }: CreateClosedDateInput,
  deps: Deps,
): Promise<ClosedDateDto> {
  if (date < restaurantToday(deps)) {
    throw validationError([{ field: "date", reason: "Date must be today or later" }]);
  }
  try {
    await ClosedDate.create({ date, reason });
  } catch (err) {
    if ((err as { code?: unknown }).code === 11000) throw conflict("This date is already closed");
    throw err;
  }
  return { date, reason };
}

export async function listClosedDates(
  { includePast }: ListClosedDatesQuery,
  deps: Deps,
): Promise<ClosedDateDto[]> {
  const filter = includePast === "true" ? {} : { date: { $gte: restaurantToday(deps) } };
  const docs = await ClosedDate.find(filter, { _id: 0, date: 1, reason: 1 })
    .sort({ date: 1 })
    .lean();
  return docs.map(({ date, reason }) => ({ date, reason: reason ?? null }));
}

export async function removeClosedDate(date: string): Promise<void> {
  const { deletedCount } = await ClosedDate.deleteOne({ date });
  if (deletedCount === 0) throw notFound("Closed date not found");
}
