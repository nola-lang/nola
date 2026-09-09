import type { ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { readSplitLayout, writeSplitLayout } from "../split-layout";

/**
 * The master/detail row every view is built on: the list pane on the left,
 * the detail on the right, a draggable (and keyboard-operable) separator
 * between them. The master opens at the width the fixed pane used to have and
 * keeps its pixel width when the window resizes; neither side can be dragged
 * below a floor. The split is remembered in localStorage across reloads.
 */
export function SplitPane({ master, children }: { master: ReactNode; children: ReactNode }) {
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={readSplitLayout(localStorage)}
      onLayoutChanged={(layout) => writeSplitLayout(localStorage, layout)}
    >
      <ResizablePanel id="master" defaultSize={380} minSize={260} groupResizeBehavior="preserve-pixel-size">
        {master}
      </ResizablePanel>
      <ResizableHandle className="after:z-10 after:w-1.5 hover:bg-foreground/30 data-[resize-handle-state=drag]:bg-foreground/30" />
      <ResizablePanel id="detail" minSize="40%">
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
