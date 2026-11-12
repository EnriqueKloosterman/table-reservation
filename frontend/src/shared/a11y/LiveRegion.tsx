import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface Announcer {
  /** Neutral change, announced politely. */
  polite: (text: string) => void;
  /** Failure or validation problem, announced assertively. */
  assertive: (text: string) => void;
}

const AnnouncerContext = createContext<Announcer>({
  polite: () => undefined,
  assertive: () => undefined,
});

const HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

export function LiveRegionProvider({ children }: { children: ReactNode }) {
  const [politeText, setPoliteText] = useState("");
  const [alertText, setAlertText] = useState("");

  // The text is written after mount, so assistive technology announces it.
  const polite = useCallback((text: string) => {
    setPoliteText(text);
  }, []);
  const assertive = useCallback((text: string) => {
    setAlertText(text);
  }, []);
  const announcer = useMemo(() => ({ polite, assertive }), [polite, assertive]);

  return (
    <AnnouncerContext.Provider value={announcer}>
      {children}
      <div role="status" aria-live="polite" style={HIDDEN}>
        {politeText}
      </div>
      <div role="alert" aria-live="assertive" style={HIDDEN}>
        {alertText}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnounce(): Announcer {
  return useContext(AnnouncerContext);
}
