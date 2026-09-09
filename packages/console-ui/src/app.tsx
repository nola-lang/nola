import { useQuery } from "@tanstack/react-query";
import { BookOpen, ListTree } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, Outlet, Route, Routes, useMatch, useSearchParams } from "react-router";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fetchProjects, type ProjectSummary } from "./api";
import { FilterBar } from "./components/filter-bar";
import { GitHubIcon, MessageCircleAsk } from "./components/icons";
import { DOCS_URL, GITHUB_URL } from "./links";
import { withSearch } from "./search";
import { AsksView } from "./views/asks";
import { TracesView } from "./views/traces";

export function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/traces" replace />} />
          <Route path="traces" element={<TracesView />} />
          <Route path="traces/:invocationId" element={<TracesView />} />
          <Route path="asks" element={<AsksView />} />
          <Route path="asks/:def" element={<AsksView />} />
          <Route path="*" element={<Navigate to="/traces" replace />} />
        </Route>
      </Routes>
    </TooltipProvider>
  );
}

const EMPTY_PROJECTS: ProjectSummary[] = [];

function Shell() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects }).data ?? EMPTY_PROJECTS;
  return (
    <div className="flex h-screen">
      {/* Activity bar: icons only, never expands (VS Code style). */}
      <nav className="flex w-12 shrink-0 flex-col border-r" aria-label="Views">
        <Link to="/" className="grid h-12 place-items-center focus-visible:outline-2 focus-visible:outline-ring" title="Nola Console">
          <img src="/nola.svg" alt="Nola" className="block w-6.5" />
        </Link>
        <ActivityItem to="/traces" label="Traces">
          <ListTree className="size-5.5" strokeWidth={1.75} />
        </ActivityItem>
        <ActivityItem to="/asks" label="Asks">
          <MessageCircleAsk className="size-5.5" strokeWidth={1.75} />
        </ActivityItem>
        <div className="mt-auto flex flex-col">
          <ActivityLink href={DOCS_URL} label="Documentation">
            <BookOpen className="size-5.5" strokeWidth={1.75} />
          </ActivityLink>
          <ActivityLink href={GITHUB_URL} label="GitHub">
            <GitHubIcon className="size-5" />
          </ActivityLink>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="grid h-8 place-items-center font-mono text-[10px] text-muted-foreground">{__NOLA_VERSION__}</span>
            </TooltipTrigger>
            <TooltipContent side="right">Nola Console {__NOLA_VERSION__}</TooltipContent>
          </Tooltip>
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-4 border-b px-3">
          <FilterBar projects={projects} />
        </header>
        <Outlet />
      </div>
    </div>
  );
}

const ACTIVITY_ITEM =
  "grid h-11 place-items-center border-l-2 border-transparent pr-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** An outbound link in the activity bar's bottom group. */
function ActivityLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={ACTIVITY_ITEM}>
          {children}
        </a>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function ActivityItem({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  // Not NavLink: TooltipTrigger's Slot joins className values as strings, so a
  // className FUNCTION would be stringified and the active classes never land.
  const active = useMatch({ path: to, end: false }) !== null;
  // The filter lives in the search params and follows the window between views; the open ask does not.
  const [search] = useSearchParams();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={{ pathname: to, search: withSearch(search, { ask: undefined }) }}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={cn(ACTIVITY_ITEM, active && "border-l-primary bg-card text-foreground")}
        >
          {children}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
