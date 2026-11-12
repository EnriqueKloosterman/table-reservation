import { useEffect, useRef, type RefObject } from "react";

/**
 * Focuses the element (which needs tabIndex={-1}) when `key` changes.
 * With `onMount` the element is also focused when it first appears.
 */
export function useFocusOnChange(
  ref: RefObject<HTMLElement | null>,
  key: unknown,
  onMount = false,
): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!onMount) return;
    }
    ref.current?.focus();
  }, [ref, key, onMount]);
}
