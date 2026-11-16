import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const KNOWN_PATHS = ["/", "/cancel"];

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function currentPath(): string {
  const path = window.location.pathname;
  if (KNOWN_PATHS.includes(path)) return path;
  window.history.replaceState(null, "", "/");
  return "/";
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, currentPath);
}

export function navigate(path: string): void {
  window.history.pushState(null, "", path);
  notify();
}
