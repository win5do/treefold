import { useState } from "react";
import type { NewSessionKind, Directory } from "@/domain/types";
import { NewSessionDialog } from "./NewSessionDialog";

type Request = { name: string; directories: Directory[]; create: (kind: NewSessionKind, directory: Directory) => void };
export function useNewSession() {
  const [request, setRequest] = useState<Request | null>(null);
  return {
    open: setRequest,
    dialog: request && <NewSessionDialog name={request.name} directories={request.directories}
      onClose={() => setRequest(null)} onCreate={(kind, directory) => {
        setRequest(null);
        request.create(kind, directory);
      }} />,
  };
}
