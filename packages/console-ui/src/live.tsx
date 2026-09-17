import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { subscribe } from "./api";
import { createLiveSync } from "./live-sync";

/**
 * Live updates: the event stream feeds `createLiveSync`, which patches the
 * cached views at once and refetches behind the patch. Nothing else in the
 * app needs to know about the event stream.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const sync = createLiveSync(queryClient);
    const unsubscribe = subscribe(sync.onNotice);
    return () => {
      unsubscribe();
      sync.dispose();
    };
  }, [queryClient]);
  return children;
}
