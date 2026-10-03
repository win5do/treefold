import { useState } from "react";
import type { AgentKind, Directory } from "@/domain/types";
import { NewSessionDialog } from "./NewSessionDialog";

type Request = { name: string; directories: Directory[]; create: (kind: AgentKind, directory: Directory) => void };
export function useNewAgentSession() {
  const [request, setRequest] = useState<Request | null>(null);
  return {
    open: setRequest,
    dialog: request && <NewSessionDialog name={request.name} directories={request.directories} initialType="agent" agentOnly
      onClose={() => setRequest(null)} onCreate={(kind, directory) => {
        if (kind !== "shell") { setRequest(null); request.create(kind, directory); }
      }} />,
  };
}
