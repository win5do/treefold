import type { Directory, Workspace } from "@/domain/types";

export type AgentReviewTarget = Pick<Workspace, "id" | "name" | "project_id"> & {
  directories?: Directory[];
};

export type AgentReviewActions = {
  open: (workspace: AgentReviewTarget) => void;
};
