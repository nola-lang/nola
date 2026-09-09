import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app";
import "./index.css";
import { LiveProvider } from "./live";

// Freshness comes from the live stream (LiveProvider invalidates everything on
// each ingested envelope), so queries never need to poll or refetch on focus.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, refetchOnWindowFocus: false, retry: 1 } },
});

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <LiveProvider>
          <App />
        </LiveProvider>
      </QueryClientProvider>
    </BrowserRouter>,
  );
