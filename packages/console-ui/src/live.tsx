import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { subscribe } from "./api";

/**
 * Live updates: every ingested envelope means "something changed", so the
 * whole query cache is invalidated (debounced) and mounted queries refetch.
 * Nothing else in the app needs to know about the event stream.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void queryClient.invalidateQueries(), 250);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [queryClient]);
  return children;
}
