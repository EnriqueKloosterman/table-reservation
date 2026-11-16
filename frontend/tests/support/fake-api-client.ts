import type {
  Aborted,
  ApiClient,
  ApiResult,
  BookableTimes,
  CancelInput,
  CancelRefusal,
  CancellationDone,
  Confirmation,
  CreateInput,
  CreateRefusal,
  TimesQuery,
  TimesRefusal,
} from "../../src/api/types";
import type { Deferred } from "./deferred";

type Scripted<T> = T | ((input: never) => T);

interface Operation<I, R> {
  /** Results returned in order; the last one repeats. */
  queue: R[];
  calls: I[];
  /** Optional gate: the call waits until it resolves. */
  gates: Deferred<void>[];
}

function operation<I, R>(): Operation<I, R> {
  return { queue: [], calls: [], gates: [] };
}

export type TimesResult = ApiResult<BookableTimes, TimesRefusal>;
export type CreateResult = ApiResult<Confirmation, CreateRefusal>;
export type CancelResult = ApiResult<CancellationDone, CancelRefusal>;

export class FakeApiClient implements ApiClient {
  readonly times = operation<TimesQuery, TimesResult>();
  readonly create = operation<CreateInput, CreateResult>();
  readonly cancel = operation<CancelInput, CancelResult>();

  /** Script the results of an operation (kept in order; the last repeats). */
  script<I, R>(op: Operation<I, R>, ...results: R[]): this {
    op.queue.push(...results);
    return this;
  }

  /** Make the next call of an operation wait until `gate` resolves. */
  gate<I, R>(op: Operation<I, R>, gate: Deferred<void>): this {
    op.gates.push(gate);
    return this;
  }

  private async run<I, R extends { kind: string }>(
    op: Operation<I, R>,
    input: I,
    signal?: AbortSignal,
  ): Promise<R | Aborted> {
    op.calls.push(input);
    const gate = op.gates.shift();
    const index = op.calls.length - 1;
    const result = op.queue[Math.min(index, op.queue.length - 1)];
    if (result === undefined) throw new Error("FakeApiClient: no scripted result for this call.");
    if (gate) {
      await new Promise<void>((resolve) => {
        const abort = () => {
          resolve();
        };
        signal?.addEventListener("abort", abort, { once: true });
        void gate.promise.then(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        });
      });
    }
    if (signal?.aborted) return { kind: "aborted" };
    return result;
  }

  getTimes(query: TimesQuery, signal?: AbortSignal) {
    return this.run(this.times, query, signal);
  }

  createReservation(input: CreateInput, signal?: AbortSignal) {
    return this.run(this.create, input, signal);
  }

  cancelReservation(input: CancelInput, signal?: AbortSignal) {
    return this.run(this.cancel, input, signal);
  }
}

export type { Scripted };
