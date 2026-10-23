import { useEffect, useState } from "react";

import { INITIAL_SNAPSHOT, type DictationSnapshot } from "./types";
import type { DictationController } from "./controller";

export function useDictation(controller: DictationController): DictationSnapshot {
  const [snapshot, setSnapshot] = useState<DictationSnapshot>(controller.current);
  useEffect(() => controller.subscribe(setSnapshot), [controller]);
  return snapshot;
}

/** Igual, pero para la pastilla: escucha el evento en vez de tener el controller. */
export function useRemoteDictation(
  subscribe: (listener: (snapshot: DictationSnapshot) => void) => () => void,
): DictationSnapshot {
  const [snapshot, setSnapshot] = useState<DictationSnapshot>(INITIAL_SNAPSHOT);
  useEffect(() => subscribe(setSnapshot), [subscribe]);
  return snapshot;
}
