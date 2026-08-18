import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Spinner } from "@/components/ui/spinner";

const WorkspaceApp = lazy(() => import("@/app/WorkspaceApp"));
function LoadingRoute() {
  return (
    <main className="flex min-h-screen items-center justify-center" aria-busy="true">
      <Spinner />
    </main>
  );
}

export default function App() {
  return (
    <Suspense fallback={<LoadingRoute />}>
      <Routes>
        <Route path="/" element={<WorkspaceApp />} />
        <Route path="/projects" element={<WorkspaceApp />} />
        <Route path="/projects/:projectId" element={<WorkspaceApp />} />
        <Route
          path="/projects/:projectId/sessions/:sessionId"
          element={<WorkspaceApp />}
        />
        <Route path="/workspaces/:workspaceId" element={<WorkspaceApp />} />
        <Route
          path="/workspaces/:workspaceId/sessions/:sessionId"
          element={<WorkspaceApp />}
        />
        <Route path="*" element={<WorkspaceApp />} />
      </Routes>
    </Suspense>
  );
}
