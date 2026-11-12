/** Shared names for the states of any server-dependent region. */
export type RequestStatus = "loading" | "empty" | "error" | "unreachable" | "ready";

export function isFailure(status: RequestStatus): boolean {
  return status === "error" || status === "unreachable";
}

export function isSettled(status: RequestStatus): boolean {
  return status !== "loading";
}
