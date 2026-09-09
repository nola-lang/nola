import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { type Filter, type ProjectQuery, parseFilter, planProjectQueries } from "./filter";

/** The window's filter, straight from the URL. */
export function useFilter(): Filter {
  const [search] = useSearchParams();
  return useMemo(() => parseFilter(search), [search]);
}

/** The server queries the filter's project selection stands for. */
export function useProjectQueries(): ProjectQuery[] {
  const filter = useFilter();
  return useMemo(() => planProjectQueries(filter.projects), [filter]);
}
