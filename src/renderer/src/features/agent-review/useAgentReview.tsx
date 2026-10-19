import { useState } from "react";
import type { Session } from "@/domain/types";
import { AgentReviewDialog } from "./AgentReviewDialog";
import type { AgentReviewTarget } from "./model";

export function useAgentReview(onCreated: (session: Session) => void) {
  const [workspace, setWorkspace] = useState<AgentReviewTarget | null>(null);
  return {
    open: setWorkspace,
    dialog: workspace && <AgentReviewDialog key={workspace.id} workspace={workspace}
      onClose={() => setWorkspace(null)} onCreated={session => {
        setWorkspace(null);
        onCreated(session);
      }} />,
  };
}
