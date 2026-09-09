import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { clearRecords } from "../api";
import { withSearch } from "../search";

/**
 * The list-level "Clear traces" action: a confirm dialog, then DELETE
 * /api/records. Everything goes — asks and definitions derive from the same
 * store — so the confirm says so. Afterwards the open trace is dropped (the
 * filter stays) and the queries refetch.
 */
export function ClearTraces({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const queryClient = useQueryClient();
  const clear = useMutation({
    mutationFn: clearRecords,
    onSuccess: async () => {
      setOpen(false);
      await navigate(`/traces${withSearch(search, { ask: undefined })}`, { replace: true });
      await queryClient.invalidateQueries();
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs" className="font-normal text-muted-foreground" disabled={disabled} title="Clear traces">
          <Trash2 />
          Clear
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Clear all traces?</DialogTitle>
          <DialogDescription>
            Every recorded invocation and ask is deleted from this console, along with the ask definitions built from
            them. New runs keep arriving as before.
          </DialogDescription>
        </DialogHeader>
        {clear.isError && <p className="m-0 font-mono text-err text-xs">{String(clear.error)}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" size="sm" onClick={() => clear.mutate()} disabled={clear.isPending}>
            {clear.isPending ? "Clearing…" : "Clear traces"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
