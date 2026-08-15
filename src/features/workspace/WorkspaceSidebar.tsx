import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  Download,
  Ellipsis,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  PanelsTopLeft,
  Pencil,
  Plus,
  Settings,
  Shell,
  TerminalSquare,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { StatusDot } from "@/components/app/StatusDot";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type {
  Directory,
  ProjectDetail,
  ProjectRepository,
  Session,
  SessionMenuState,
  Workspace,
  WorkspaceLocation,
} from "@/domain/types";
import { AmuxResourcesPopover } from "@/features/resources/AmuxResourcesPopover";
import { cn } from "@/lib/utils";

export function WorkspaceSidebar({
  projects,
  busy,
  selectedProjectId,
  selectedWorkspaceId,
  selectedSessionId,
  hidden,
  mobileOpen,
  resizing,
  expandedProjects,
  expandedWorkspaces,
  closingSessionIds,
  sessionMenu,
  onToggleProject,
  onToggleWorkspace,
  onSessionMenu,
  onNavigate,
  onCreateProject,
  onCreateWorkspace,
  onCreateFork,
  onCreateShell,
  onCreateCodex,
  onCreateBaseShell,
  onCreateBaseCodex,
  onOpenInFinder,
  onSyncProject,
  onSyncProjectLocation,
  onSyncWorkspace,
  onSyncWorkspaceLocation,
  onFinishWorkspace,
  onRenameProject,
  onRenameWorkspace,
  onRenameSession,
  onReorderSessions,
  onArchiveProject,
  onCloseSession,
  onCloseProjectSession,
  onResizeStart,
  onResizeKeyboard,
  onSettings,
}: {
  projects: ProjectDetail[];
  busy: boolean;
  selectedProjectId?: string;
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  hidden: boolean;
  mobileOpen: boolean;
  resizing: boolean;
  expandedProjects: Set<string>;
  expandedWorkspaces: Set<string>;
  closingSessionIds: Set<string>;
  sessionMenu: SessionMenuState | null;
  onToggleProject: (id: string) => void;
  onToggleWorkspace: (id: string) => void;
  onSessionMenu: (menu: SessionMenuState | null) => void;
  onNavigate: (path: string) => void;
  onCreateProject: () => void;
  onCreateWorkspace: (project: ProjectDetail) => void;
  onCreateFork: (workspace: Workspace) => void;
  onCreateShell: (stream: Workspace, directory?: Directory) => void;
  onCreateCodex: (stream: Workspace, directory?: Directory) => void;
  onCreateBaseShell: (project: ProjectDetail, directory?: Directory) => void;
  onCreateBaseCodex: (project: ProjectDetail, directory?: Directory) => void;
  onOpenInFinder: (project: ProjectDetail, stream?: Workspace) => void;
  onSyncProject: (project: ProjectDetail, action: "pull" | "push") => void;
  onSyncProjectLocation: (
    repository: ProjectRepository,
    action: "pull" | "push",
  ) => void;
  onSyncWorkspace: (stream: Workspace, action: "pull" | "push") => void;
  onSyncWorkspaceLocation: (
    location: WorkspaceLocation,
    action: "pull" | "push",
  ) => void;
  onFinishWorkspace: (stream: Workspace) => void;
  onRenameProject: (project: ProjectDetail) => void;
  onRenameWorkspace: (stream: Workspace) => void;
  onRenameSession: (session: Session) => void;
  onReorderSessions: (
    stream: Workspace,
    sourceId: string,
    targetId: string,
    position: SessionDropPosition,
  ) => void;
  onArchiveProject: (project: ProjectDetail) => void;
  onCloseSession: (stream: Workspace, session: Session) => void;
  onCloseProjectSession: (project: ProjectDetail, session: Session) => void;
  onResizeStart: () => void;
  onResizeKeyboard: (delta: number) => void;
  onSettings: () => void;
}) {
  const { t } = useTranslation();
  const [contextOwner, setContextOwner] = useState<{
    project: ProjectDetail;
    stream?: SidebarStream;
    x: number;
    y: number;
  } | null>(null);
  const openContextMenu = (
    event: React.MouseEvent,
    project: ProjectDetail,
    stream?: SidebarStream,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onSessionMenu(null);
    const position =
      event.type === "contextmenu"
        ? { x: event.clientX, y: event.clientY }
        : (() => {
            const rect = event.currentTarget.getBoundingClientRect();
            return { x: rect.left, y: rect.bottom + 4 };
          })();
    setContextOwner((current) =>
      current?.project.id === project.id && current.stream?.id === stream?.id
        ? null
        : { project, stream, ...position },
    );
  };
  const renderOwnerContextMenu = (
    project: ProjectDetail,
    stream: SidebarStream | undefined,
    trigger: React.ReactNode,
  ) => (
    <SidebarOwnerContextMenu
      project={project}
      stream={stream}
      busy={busy}
      onCreateWorkspace={onCreateWorkspace}
      onCreateFork={onCreateFork}
      onCreateShell={(directory) =>
        stream
          ? onCreateShell(stream, directory)
          : onCreateBaseShell(project, directory)
      }
      onCreateCodex={(directory) =>
        stream
          ? onCreateCodex(stream, directory)
          : onCreateBaseCodex(project, directory)
      }
      onOpenInFinder={() => onOpenInFinder(project, stream)}
      onSync={(targetId, action) => {
        if (!stream) {
          const repository = project.repositories.find(
            (item) => item.id === targetId,
          );
          repository
            ? onSyncProjectLocation(repository, action)
            : onSyncProject(project, action);
          return;
        }
        const location = stream.locations?.find((item) => item.id === targetId);
        location
          ? onSyncWorkspaceLocation(location, action)
          : onSyncWorkspace(stream, action);
      }}
      onRename={() =>
        stream ? onRenameWorkspace(stream) : onRenameProject(project)
      }
      onFinish={() =>
        stream ? onFinishWorkspace(stream) : onArchiveProject(project)
      }
    >
      {trigger}
    </SidebarOwnerContextMenu>
  );
  useEffect(() => {
    if (!contextOwner && !sessionMenu) return;
    const close = () => {
      setContextOwner(null);
      onSessionMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextOwner, onSessionMenu, sessionMenu]);
  const projectsActive =
    !selectedProjectId && !selectedWorkspaceId && !selectedSessionId;
  return (
    <aside
      data-testid="workspace-sidebar"
      className={cn(
        "absolute inset-y-0 left-0 z-40 flex w-[var(--sidebar-width)] min-w-[240px] max-w-[calc(100vw-2rem)] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:max-w-[520px]",
        !resizing && "transition-transform duration-200",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        hidden ? "md:-translate-x-full" : "md:translate-x-0",
      )}
    >
      <div className="flex h-10 items-center px-2 text-[13px]">
        <div
          className={cn(
            "group flex h-8 min-w-0 flex-1 items-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-within:bg-background/60 focus-within:text-foreground",
            projectsActive && "bg-background/70 text-foreground",
          )}
        >
          <button
            data-testid="sidebar-projects-link"
            aria-current={projectsActive ? "page" : undefined}
            className="flex h-full min-w-0 flex-1 items-center px-2 text-left focus-visible:outline-none"
            onClick={() => onNavigate("/")}
          >
            <span className="truncate font-semibold">
              {t("sidebar.projects")}
            </span>
          </button>
          <Button
            data-sidebar-row-action="true"
            size="icon"
            variant="ghost"
            aria-label={t("sidebar.newProject")}
            title={t("sidebar.newProject")}
            onClick={onCreateProject}
          >
            <Plus data-icon="inline-start" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {projects
          .filter((project) => project.status === "active")
          .map((project) => {
            const projectOpen = expandedProjects.has(project.id);
            const activeRootWorkspaces = project.workspaces.filter(
              (item) => item.status === "active" && !item.parent_workspace_id,
            );
            return (
              <div key={project.id} className="relative mb-1">
                {renderOwnerContextMenu(
                  project,
                  undefined,
                  <div
                    data-testid="sidebar-project-node"
                    className={cn(
                      sidebarTreeRowClass,
                      "font-semibold",
                      selectedProjectId === project.id &&
                        !selectedSessionId &&
                        sidebarSelectedRowClass,
                    )}
                  >
                    <button
                      data-testid="sidebar-tree-toggle"
                      className={sidebarTreeToggleClass}
                      aria-label={t(
                        projectOpen
                          ? "sidebar.collapseProject"
                          : "sidebar.expandProject",
                        { name: project.name },
                      )}
                      aria-expanded={projectOpen}
                      onClick={() => onToggleProject(project.id)}
                    >
                      {projectOpen ? (
                        <ChevronDown
                          data-testid="sidebar-tree-chevron"
                          className="size-3.5"
                        />
                      ) : (
                        <ChevronRight
                          data-testid="sidebar-tree-chevron"
                          className="size-3.5"
                        />
                      )}
                    </button>
                    <button
                      data-testid="sidebar-project-link"
                      className={sidebarTreeLinkClass}
                      title={project.name}
                      onClick={() => onNavigate(`/projects/${project.id}`)}
                    >
                      <FolderGit2
                        data-testid="sidebar-tree-icon"
                        className={sidebarTreeIconClass}
                      />
                      <span
                        data-sidebar-tree-label="true"
                        className="min-w-0 flex-1 truncate"
                      >
                        {project.name}
                      </span>
                    </button>
                    <SidebarNodeActions
                      menuLabel={t("sidebar.projectActions", {
                        name: project.name,
                      })}
                      createLabel={t("sidebar.newInProject", {
                        name: project.name,
                      })}
                      createTestId="sidebar-project-action"
                      onMenu={(event) => openContextMenu(event, project)}
                      onCreate={(event) => {
                        setContextOwner(null);
                        const id = `project:${project.id}`;
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        onSessionMenu(
                          sessionMenu?.id === id
                            ? null
                            : { id, x: rect.left, y: rect.bottom + 4 },
                        );
                      }}
                    />
                  </div>,
                )}
                {sessionMenu?.id === `project:${project.id}` && (
                  <SessionDirectoryMenu
                    testId="sidebar-session-menu"
                    directories={project.directories}
                    position={sessionMenu}
                    primaryAction={
                      <SidebarMenuButton
                        testId="create-workspace-action"
                        icon={<Workflow />}
                        onClick={() => {
                          onSessionMenu(null);
                          onCreateWorkspace(project);
                        }}
                      >
                        {t("sidebar.newWorkspace")}
                      </SidebarMenuButton>
                    }
                    onShell={(directory) => {
                      onSessionMenu(null);
                      onCreateBaseShell(project, directory);
                    }}
                    onCodex={(directory) => {
                      onSessionMenu(null);
                      onCreateBaseCodex(project, directory);
                    }}
                  />
                )}
                {projectOpen && (
                  <div
                    data-testid="sidebar-project-children"
                    className={sidebarTreeChildrenClass}
                  >
                    <SidebarProjectSessions
                      project={project}
                      selectedSessionId={selectedSessionId}
                      closingSessionIds={closingSessionIds}
                      onNavigate={onNavigate}
                      onRenameSession={onRenameSession}
                      onCloseSession={onCloseProjectSession}
                    />
                    {activeRootWorkspaces.map((stream) => (
                      <SidebarWorkspaceNode
                        key={stream.id}
                        stream={stream}
                        allStreams={project.workspaces}
                        selectedWorkspaceId={selectedWorkspaceId}
                        selectedSessionId={selectedSessionId}
                        expandedWorkspaces={expandedWorkspaces}
                        closingSessionIds={closingSessionIds}
                        sessionMenu={sessionMenu}
                        onToggleWorkspace={onToggleWorkspace}
                        onSessionMenu={onSessionMenu}
                        onNavigate={onNavigate}
                        onCreateShell={onCreateShell}
                        onCreateCodex={onCreateCodex}
                        onCreateFork={onCreateFork}
                        onOpenContext={(event, stream) =>
                          openContextMenu(event, project, stream)
                        }
                        renderOwnerContext={(stream, trigger) =>
                          renderOwnerContextMenu(project, stream, trigger)
                        }
                        onRenameSession={onRenameSession}
                        onReorderSessions={onReorderSessions}
                        onCloseSession={onCloseSession}
                      />
                    ))}
                    {activeRootWorkspaces.length === 0 && (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground/70">
                        {t("sidebar.noWorkspaces")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>
      {contextOwner && (
        <SessionDirectoryMenu
          testId="directory-session-context-menu"
          directories={
            contextOwner.stream?.directories ?? contextOwner.project.directories
          }
          position={contextOwner}
          primaryAction={
            !contextOwner.stream ? (
              <SidebarMenuButton
                testId="create-workspace-action"
                icon={<Workflow />}
                onClick={() => {
                  const owner = contextOwner;
                  setContextOwner(null);
                  onCreateWorkspace(owner.project);
                }}
              >
                {t("sidebar.newWorkspace")}
              </SidebarMenuButton>
            ) : contextOwner.stream.kind === "workspace" ? (
              <SidebarMenuButton
                testId="create-fork-action"
                icon={<GitBranch />}
                onClick={() => {
                  const owner = contextOwner;
                  setContextOwner(null);
                  onCreateFork(owner.stream!);
                }}
              >
                {t("sidebar.newFork")}
              </SidebarMenuButton>
            ) : undefined
          }
          syncTargets={
            !contextOwner.stream
              ? contextOwner.project.repositories
                  .filter((repository) => repository.git_status === "ready")
                  .map((repository) => ({
                    id: repository.id,
                    name: repository.name,
                  }))
              : contextOwner.stream.kind === "workspace"
                ? (contextOwner.stream.locations ?? [])
                    .filter(
                      (location) =>
                        location.access_mode === "read_write" &&
                        location.git_status === "ready",
                    )
                    .map((location) => ({
                      id: location.id,
                      name: location.location_name,
                    }))
                : undefined
          }
          busy={busy}
          footerRows={3}
          onSync={(targetId, action) => {
            const owner = contextOwner;
            setContextOwner(null);
            if (!owner.stream) {
              const repository = owner.project.repositories.find(
                (item) => item.id === targetId,
              );
              repository
                ? onSyncProjectLocation(repository, action)
                : onSyncProject(owner.project, action);
              return;
            }
            const location = owner.stream.locations?.find(
              (item) => item.id === targetId,
            );
            location
              ? onSyncWorkspaceLocation(location, action)
              : onSyncWorkspace(owner.stream, action);
          }}
          onShell={(directory) => {
            const owner = contextOwner;
            setContextOwner(null);
            owner.stream
              ? onCreateShell(owner.stream, directory)
              : onCreateBaseShell(owner.project, directory);
          }}
          onCodex={(directory) => {
            const owner = contextOwner;
            setContextOwner(null);
            owner.stream
              ? onCreateCodex(owner.stream, directory)
              : onCreateBaseCodex(owner.project, directory);
          }}
          footer={
            <>
              <SidebarMenuButton
                icon={<FolderOpen />}
                onClick={() => {
                  const owner = contextOwner;
                  setContextOwner(null);
                  onOpenInFinder(owner.project, owner.stream);
                }}
              >
                {t("sidebar.openInFinder")}
              </SidebarMenuButton>
              <SidebarMenuButton
                testId="rename-node-action"
                icon={<Pencil />}
                onClick={() => {
                  const owner = contextOwner;
                  setContextOwner(null);
                  owner.stream
                    ? onRenameWorkspace(owner.stream)
                    : onRenameProject(owner.project);
                }}
              >
                {t("sidebar.rename")}
              </SidebarMenuButton>
              {contextOwner.stream ? (
                <SidebarMenuButton
                  testId="finish-workspace-action"
                  destructive
                  icon={<X />}
                  onClick={() => {
                    const owner = contextOwner;
                    setContextOwner(null);
                    onFinishWorkspace(owner.stream!);
                  }}
                >
                  {t(
                    contextOwner.stream.kind === "fork"
                      ? "sidebar.finishFork"
                      : "sidebar.finishWorkspace",
                  )}
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton
                  testId="archive-project-action"
                  destructive
                  icon={<Archive />}
                  onClick={() => {
                    const owner = contextOwner;
                    setContextOwner(null);
                    onArchiveProject(owner.project);
                  }}
                >
                  {t("sidebar.archiveProject")}
                </SidebarMenuButton>
              )}
            </>
          }
        />
      )}
      <div className="flex items-center gap-1 border-t border-border p-2">
        <Button
          data-testid="open-settings"
          size="icon"
          variant="ghost"
          aria-label={t("sidebar.settings")}
          title={t("sidebar.settings")}
          onClick={onSettings}
        >
          <Settings data-icon="inline-start" />
        </Button>
        <AmuxResourcesPopover />
      </div>
      <div
        data-testid="sidebar-resize-handle"
        role="separator"
        aria-label={t("sidebar.resize")}
        aria-orientation="vertical"
        tabIndex={0}
        className="absolute inset-y-0 right-0 hidden w-1 translate-x-1/2 cursor-col-resize touch-none hover:bg-ring/50 focus:bg-ring/50 md:block"
        onPointerDown={(event) => {
          event.preventDefault();
          onResizeStart();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onResizeKeyboard(-16);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            onResizeKeyboard(16);
          }
        }}
      />
    </aside>
  );
}

export type SidebarStream = Workspace & {
  sessions?: Session[];
  directories?: Directory[];
  locations?: WorkspaceLocation[];
  forks?: Workspace[];
};
export type SessionDropPosition = "before" | "after";

function directoryMenuLabel(directory: Directory, directories: Directory[]) {
  const duplicate = directories.some(
    (candidate) =>
      candidate.id !== directory.id && candidate.name === directory.name,
  );
  return duplicate && directory.repository_name
    ? `${directory.name} · ${directory.repository_name}`
    : directory.name;
}

function SidebarOwnerContextMenu({
  project,
  stream,
  busy,
  children,
  onCreateWorkspace,
  onCreateFork,
  onCreateShell,
  onCreateCodex,
  onOpenInFinder,
  onSync,
  onRename,
  onFinish,
}: {
  project: ProjectDetail;
  stream?: SidebarStream;
  busy: boolean;
  children: React.ReactNode;
  onCreateWorkspace: (project: ProjectDetail) => void;
  onCreateFork: (stream: Workspace) => void;
  onCreateShell: (directory: Directory) => void;
  onCreateCodex: (directory: Directory) => void;
  onOpenInFinder: () => void;
  onSync: (targetId: string | null, action: "pull" | "push") => void;
  onRename: () => void;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const directories = stream?.directories ?? project.directories;
  const syncTargets = !stream
    ? project.repositories
        .filter((repository) => repository.git_status === "ready")
        .map((repository) => ({ id: repository.id, name: repository.name }))
    : stream.kind === "workspace"
      ? (stream.locations ?? [])
          .filter(
            (location) =>
              location.access_mode === "read_write" &&
              location.git_status === "ready",
          )
          .map((location) => ({
            id: location.id,
            name: location.location_name,
          }))
      : null;
  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent
        data-testid="directory-session-context-menu"
        className="w-52"
      >
        <ContextMenuGroup>
          {!stream && (
            <ContextMenuItem
              data-testid="create-workspace-action"
              onClick={() => onCreateWorkspace(project)}
            >
              <Workflow />
              {t("sidebar.newWorkspace")}
            </ContextMenuItem>
          )}
          {stream?.kind === "workspace" && (
            <ContextMenuItem
              data-testid="create-fork-action"
              onClick={() => onCreateFork(stream)}
            >
              <GitBranch />
              {t("sidebar.newFork")}
            </ContextMenuItem>
          )}
        </ContextMenuGroup>
        {(!stream || stream.kind === "workspace") && <ContextMenuSeparator />}
        <ContextMenuGroup>
          <ContextMenuLabel>{t("sidebar.newSessionIn")}</ContextMenuLabel>
          {(["shell", "codex"] as const).map((kind) => (
            <ContextMenuSub key={kind}>
              <ContextMenuSubTrigger data-testid={`session-kind-${kind}`}>
                {kind === "shell" ? <Shell /> : <Bot />}
                {kind === "shell" ? "Shell" : "Agent"}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent
                data-testid="directory-session-submenu"
                className="w-44"
              >
                <ContextMenuGroup>
                  <ContextMenuLabel>
                    {kind === "shell" ? "Shell" : "Agent"}
                  </ContextMenuLabel>
                  {directories.map((directory) => (
                    <ContextMenuItem
                      key={directory.id}
                      data-testid={`session-directory-${directory.id}`}
                      disabled={
                        kind === "codex" &&
                        (!directory.is_git || directory.git_status !== "ready")
                      }
                      onClick={() =>
                        kind === "shell"
                          ? onCreateShell(directory)
                          : onCreateCodex(directory)
                      }
                    >
                      {directory.is_git ? <FolderGit2 /> : <Folder />}
                      {directoryMenuLabel(directory, directories)}
                      {directory.role === "primary"
                        ? ` · ${t("sidebar.primary")}`
                        : ""}
                    </ContextMenuItem>
                  ))}
                </ContextMenuGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          ))}
        </ContextMenuGroup>
        {syncTargets && (
          <>
            <ContextMenuSeparator />
            {(["pull", "push"] as const).map((action) => (
              <ContextMenuSub key={action}>
                <ContextMenuSubTrigger
                  data-testid={`sidebar-${action}-menu`}
                  disabled={busy || syncTargets.length === 0}
                >
                  {action === "pull" ? <Download /> : <Upload />}
                  {t(`sidebar.${action}`)}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent
                  data-testid="sidebar-git-submenu"
                  className="w-44"
                >
                  <ContextMenuGroup>
                    <ContextMenuLabel>
                      {t(`sidebar.${action}`)}
                    </ContextMenuLabel>
                    <ContextMenuItem
                      data-testid={`sidebar-${action}-all`}
                      disabled={busy}
                      onClick={() => onSync(null, action)}
                    >
                      {action === "pull" ? <Download /> : <Upload />}
                      {t(`sidebar.${action}All`)}
                    </ContextMenuItem>
                    {syncTargets.map((target) => (
                      <ContextMenuItem
                        key={target.id}
                        data-testid={`sidebar-${action}-${target.id}`}
                        disabled={busy}
                        onClick={() => onSync(target.id, action)}
                      >
                        <FolderGit2 />
                        {target.name}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuGroup>
                </ContextMenuSubContent>
              </ContextMenuSub>
            ))}
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem onClick={onOpenInFinder}>
            <FolderOpen />
            {t("sidebar.openInFinder")}
          </ContextMenuItem>
          <ContextMenuItem data-testid="rename-node-action" onClick={onRename}>
            <Pencil />
            {t("sidebar.rename")}
          </ContextMenuItem>
          <ContextMenuItem
            data-testid={
              stream ? "finish-workspace-action" : "archive-project-action"
            }
            variant="destructive"
            onClick={onFinish}
          >
            {stream ? <X /> : <Archive />}
            {t(
              stream
                ? stream.kind === "fork"
                  ? "sidebar.finishFork"
                  : "sidebar.finishWorkspace"
                : "sidebar.archiveProject",
            )}
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const sidebarTreeRowClass =
  "group flex min-h-8 min-w-0 items-center rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-within:bg-background/60 focus-within:text-foreground";
const sidebarTreeToggleClass =
  "grid size-7 shrink-0 place-items-center rounded-md text-current opacity-60 transition-opacity hover:bg-foreground/5 hover:opacity-100 focus-visible:outline-none";
const sidebarTreeLinkClass =
  "flex h-8 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md text-left focus-visible:outline-none";
const sidebarTreeIconClass = "size-4 shrink-0 text-current opacity-70";
const sidebarTreeChildrenClass = "ml-3 border-l border-border/70 pl-2";
const sidebarSessionRowClass =
  "group/session flex min-h-8 items-center rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-within:bg-background/60 focus-within:text-foreground";
const sidebarSelectedRowClass =
  "bg-background text-foreground ring-1 ring-border/70 hover:bg-background";

function SessionKindIcon({ kind }: { kind: Session["kind"] }) {
  if (kind === "codex") return <Bot className={sidebarTreeIconClass} />;
  if (kind === "command")
    return <PanelsTopLeft className={sidebarTreeIconClass} />;
  return <TerminalSquare className={sidebarTreeIconClass} />;
}

function SidebarNodeActions({
  menuLabel,
  createLabel,
  createTestId,
  onMenu,
  onCreate,
}: {
  menuLabel: string;
  createLabel: string;
  createTestId: string;
  onMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onCreate: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        data-testid="sidebar-node-menu-trigger"
        size="icon"
        variant="ghost"
        className="pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
        aria-label={menuLabel}
        title={menuLabel}
        onClick={(event) => {
          event.stopPropagation();
          onMenu(event);
        }}
      >
        <Ellipsis data-icon="inline-start" />
      </Button>
      <Button
        data-testid={createTestId}
        data-sidebar-row-action="true"
        size="icon"
        variant="ghost"
        aria-label={createLabel}
        title={createLabel}
        onClick={(event) => {
          event.stopPropagation();
          onCreate(event);
        }}
      >
        <Plus data-icon="inline-start" />
      </Button>
    </div>
  );
}

function SidebarMenuButton({
  icon,
  children,
  testId,
  destructive = false,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0",
        destructive &&
          "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10",
      )}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

type SidebarNodeProps = {
  stream: SidebarStream;
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  expandedWorkspaces: Set<string>;
  closingSessionIds: Set<string>;
  sessionMenu: SessionMenuState | null;
  onToggleWorkspace: (id: string) => void;
  onSessionMenu: (menu: SessionMenuState | null) => void;
  onNavigate: (path: string) => void;
  onCreateShell: (stream: Workspace, directory?: Directory) => void;
  onCreateCodex: (stream: Workspace, directory?: Directory) => void;
  onCreateFork: (stream: Workspace) => void;
  onOpenContext: (event: React.MouseEvent, stream: SidebarStream) => void;
  renderOwnerContext: (
    stream: SidebarStream,
    trigger: React.ReactNode,
  ) => React.ReactNode;
  onRenameSession: (session: Session) => void;
  onReorderSessions: (
    stream: Workspace,
    sourceId: string,
    targetId: string,
    position: SessionDropPosition,
  ) => void;
  onCloseSession: (stream: Workspace, session: Session) => void;
};

type SidebarSyncTarget = { id: string; name: string };
type SidebarSessionKind = "shell" | "codex";
type SidebarSubmenu =
  | { kind: "session"; sessionKind: SidebarSessionKind }
  | { kind: "sync"; action: "pull" | "push" };

function resolveSessionDropPosition(
  pointerY: number,
  rect: Pick<DOMRect, "top" | "height">,
  sourceIndex: number,
  targetIndex: number,
): SessionDropPosition {
  const midpoint = rect.top + rect.height / 2;
  if (Math.abs(pointerY - midpoint) < 1)
    return sourceIndex < targetIndex ? "after" : "before";
  return pointerY < midpoint ? "before" : "after";
}

function SessionDirectoryMenu({
  directories,
  testId,
  position,
  primaryAction,
  syncTargets,
  busy = false,
  footer,
  footerRows = 1,
  onSync,
  onShell,
  onCodex,
}: {
  directories: Directory[];
  testId: string;
  position: { x: number; y: number };
  primaryAction?: React.ReactNode;
  syncTargets?: SidebarSyncTarget[];
  busy?: boolean;
  footer?: React.ReactNode;
  footerRows?: number;
  onSync?: (targetId: string | null, action: "pull" | "push") => void;
  onShell: (directory: Directory) => void;
  onCodex: (directory: Directory) => void;
}) {
  const { t } = useTranslation();
  const [submenu, setSubmenu] = useState<SidebarSubmenu | null>(null);
  const [submenuTop, setSubmenuTop] = useState(0);
  const activate = (
    next: SidebarSubmenu,
    element: HTMLButtonElement,
    submenuHeight: number,
  ) => {
    const menuTop =
      element
        .closest<HTMLElement>(`[data-testid="${testId}"]`)
        ?.getBoundingClientRect().top ?? 0;
    const availableTop = window.innerHeight - menuTop - submenuHeight - 8;
    setSubmenu(next);
    setSubmenuTop(Math.max(0, Math.min(element.offsetTop, availableTop)));
  };
  const menuHeight =
    36 +
    80 +
    (primaryAction ? 42 : 0) +
    (syncTargets ? 82 : 0) +
    (footer ? 42 * footerRows : 0);
  const left = Math.max(
    8,
    Math.min(position.x, window.innerWidth - 208 - 176 - 8),
  );
  const top = Math.max(
    8,
    Math.min(position.y, window.innerHeight - menuHeight - 8),
  );
  const activeSessionKind =
    submenu?.kind === "session" ? submenu.sessionKind : null;
  const activeSync = submenu?.kind === "sync" ? submenu.action : null;
  return createPortal(
    <div
      data-testid={testId}
      role="menu"
      className="fixed z-[100] w-52 rounded-lg border border-border bg-card p-1 shadow-xl"
      style={{ left, top }}
      onClick={(event) => event.stopPropagation()}
      onMouseLeave={() => setSubmenu(null)}
    >
      {primaryAction && (
        <div
          data-testid="session-menu-primary-action"
          className="mb-1 border-b border-border/60 pb-1"
          onMouseEnter={() => setSubmenu(null)}
          onFocus={() => setSubmenu(null)}
        >
          {primaryAction}
        </div>
      )}
      <p className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("sidebar.newSessionIn")}
      </p>
      {(["shell", "codex"] as const).map((sessionKind) => {
        const label = sessionKind === "shell" ? "Shell" : "Agent";
        return (
          <button
            key={sessionKind}
            type="button"
            role="menuitem"
            data-testid={`session-kind-${sessionKind}`}
            aria-haspopup="menu"
            aria-expanded={activeSessionKind === sessionKind}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted",
              activeSessionKind === sessionKind && "bg-muted text-foreground",
            )}
            onMouseEnter={(event) =>
              activate(
                { kind: "session", sessionKind },
                event.currentTarget,
                42 + directories.length * 36,
              )
            }
            onFocus={(event) =>
              activate(
                { kind: "session", sessionKind },
                event.currentTarget,
                42 + directories.length * 36,
              )
            }
          >
            {sessionKind === "shell" ? (
              <Shell className="size-3.5" />
            ) : (
              <Bot className="size-3.5" />
            )}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <ChevronRight
              className={cn(
                "size-3 transition-transform",
                activeSessionKind === sessionKind && "translate-x-0.5",
              )}
            />
          </button>
        );
      })}
      {syncTargets && (
        <div
          data-testid="sidebar-git-actions"
          className="mt-1 border-t border-border/60 pt-1"
        >
          {(["pull", "push"] as const).map((action) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              data-testid={`sidebar-${action}-menu`}
              disabled={busy || syncTargets.length === 0}
              aria-haspopup="menu"
              aria-expanded={activeSync === action}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40",
                activeSync === action && "bg-muted text-foreground",
              )}
              onMouseEnter={(event) =>
                activate(
                  { kind: "sync", action },
                  event.currentTarget,
                  42 + (syncTargets.length + 1) * 36,
                )
              }
              onFocus={(event) =>
                activate(
                  { kind: "sync", action },
                  event.currentTarget,
                  42 + (syncTargets.length + 1) * 36,
                )
              }
            >
              {action === "pull" ? (
                <Download className="size-3.5" />
              ) : (
                <Upload className="size-3.5" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {t(`sidebar.${action}`)}
              </span>
              <ChevronRight className="size-3" />
            </button>
          ))}
        </div>
      )}
      {activeSessionKind && (
        <div
          key={activeSessionKind}
          data-testid="directory-session-submenu"
          role="menu"
          aria-label={
            activeSessionKind === "shell"
              ? "Shell locations"
              : "Agent locations"
          }
          className="directory-session-submenu absolute left-full w-44 rounded-lg border border-border bg-card p-1 shadow-xl"
          style={{ top: submenuTop }}
        >
          <p className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {activeSessionKind === "shell" ? "Shell" : "Agent"}
          </p>
          {directories.map((directory) => (
            <SidebarMenuButton
              key={directory.id}
              testId={`session-directory-${directory.id}`}
              icon={directory.is_git ? <FolderGit2 /> : <Folder />}
              disabled={
                activeSessionKind === "codex" &&
                (!directory.is_git || directory.git_status !== "ready")
              }
              onClick={() =>
                activeSessionKind === "shell"
                  ? onShell(directory)
                  : onCodex(directory)
              }
            >
              {directoryMenuLabel(directory, directories)}
              {directory.role === "primary" ? ` · ${t("sidebar.primary")}` : ""}
            </SidebarMenuButton>
          ))}
        </div>
      )}
      {activeSync && (
        <div
          key={activeSync}
          data-testid="sidebar-git-submenu"
          role="menu"
          aria-label={t(`sidebar.${activeSync}`)}
          className="absolute left-full w-44 rounded-lg border border-border bg-card p-1 shadow-xl"
          style={{ top: submenuTop }}
        >
          <p className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t(`sidebar.${activeSync}`)}
          </p>
          <SidebarMenuButton
            testId={`sidebar-${activeSync}-all`}
            icon={activeSync === "pull" ? <Download /> : <Upload />}
            disabled={busy}
            onClick={() => onSync?.(null, activeSync)}
          >
            {t(`sidebar.${activeSync}All`)}
          </SidebarMenuButton>
          {(syncTargets ?? []).map((target) => (
            <SidebarMenuButton
              key={target.id}
              testId={`sidebar-${activeSync}-${target.id}`}
              icon={<FolderGit2 />}
              disabled={busy}
              onClick={() => onSync?.(target.id, activeSync)}
            >
              {target.name}
            </SidebarMenuButton>
          ))}
        </div>
      )}
      {footer && (
        <div
          data-testid="session-menu-footer"
          className="mt-1 border-t border-border/60 pt-1"
          onMouseEnter={() => setSubmenu(null)}
          onMouseMove={() => setSubmenu(null)}
          onFocus={() => setSubmenu(null)}
        >
          {footer}
        </div>
      )}
    </div>,
    document.body,
  );
}

function SidebarCreateSessionMenu({
  stream,
  menu,
  onSessionMenu,
  onCreateShell,
  onCreateCodex,
  onCreateFork,
  allowFork = false,
}: Pick<
  SidebarNodeProps,
  | "stream"
  | "onSessionMenu"
  | "onCreateShell"
  | "onCreateCodex"
  | "onCreateFork"
> & { menu: SessionMenuState | null; allowFork?: boolean }) {
  const { t } = useTranslation();
  if (!menu) return null;
  return (
    <SessionDirectoryMenu
      testId="sidebar-session-menu"
      directories={stream.directories ?? []}
      position={menu}
      primaryAction={
        allowFork ? (
          <SidebarMenuButton
            testId="create-fork-action"
            icon={<GitBranch />}
            onClick={() => {
              onSessionMenu(null);
              onCreateFork(stream);
            }}
          >
            {t("sidebar.newFork")}
          </SidebarMenuButton>
        ) : undefined
      }
      onShell={(directory) => {
        onSessionMenu(null);
        onCreateShell(stream, directory);
      }}
      onCodex={(directory) => {
        onSessionMenu(null);
        onCreateCodex(stream, directory);
      }}
    />
  );
}

function SidebarSessions({
  stream,
  selectedSessionId,
  closingSessionIds,
  onNavigate,
  onRenameSession,
  onReorderSessions,
  onCloseSession,
}: Pick<
  SidebarNodeProps,
  | "stream"
  | "selectedSessionId"
  | "closingSessionIds"
  | "onNavigate"
  | "onRenameSession"
  | "onReorderSessions"
  | "onCloseSession"
>) {
  const { t } = useTranslation();
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(
    null,
  );
  const [dropTarget, setDropTarget] = useState<{
    sessionId: string;
    position: SessionDropPosition;
  } | null>(null);
  const sessions =
    stream.sessions?.filter(
      (session) =>
        session.visibility === "visible" && !closingSessionIds.has(session.id),
    ) ?? [];
  const pointerDrag = useRef<{
    pointerId: number;
    sourceId: string;
    startX: number;
    startY: number;
    active: boolean;
    target: { sessionId: string; position: SessionDropPosition } | null;
  } | null>(null);
  const suppressClick = useRef(false);

  const clearPointerDrag = () => {
    pointerDrag.current = null;
    setDraggingSessionId(null);
    setDropTarget(null);
  };

  const beginPointerDrag = (
    sessionId: string,
    event: React.PointerEvent<HTMLElement>,
  ) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element &&
        event.target.closest("[data-session-close]"))
    )
      return;
    pointerDrag.current = {
      pointerId: event.pointerId,
      sourceId: sessionId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePointerDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      if (
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4
      )
        return;
      drag.active = true;
      suppressClick.current = true;
      setDraggingSessionId(drag.sourceId);
    }
    event.preventDefault();
    const targetRow = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-session-reorder-id]");
    const targetId = targetRow?.dataset.sessionReorderId;
    if (
      !targetRow ||
      targetRow.dataset.sessionOwnerId !== stream.id ||
      !targetId ||
      targetId === drag.sourceId
    ) {
      drag.target = null;
      setDropTarget(null);
      return;
    }
    const sourceIndex = sessions.findIndex((item) => item.id === drag.sourceId);
    const targetIndex = sessions.findIndex((item) => item.id === targetId);
    const position = resolveSessionDropPosition(
      event.clientY,
      targetRow.getBoundingClientRect(),
      sourceIndex,
      targetIndex,
    );
    drag.target = { sessionId: targetId, position };
    setDropTarget((current) =>
      current?.sessionId === targetId && current.position === position
        ? current
        : { sessionId: targetId, position },
    );
  };

  const finishPointerDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = drag.target;
    const active = drag.active;
    pointerDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setDraggingSessionId(null);
    setDropTarget(null);
    if (active && target)
      onReorderSessions(
        stream,
        drag.sourceId,
        target.sessionId,
        target.position,
      );
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };

  return (
    sessions.map((session) => {
      const dropPosition =
        dropTarget?.sessionId === session.id ? dropTarget.position : null;
      return (
        <ContextMenu key={session.id}>
          <ContextMenuTrigger
            data-testid={`sidebar-session-${session.id}`}
            data-session-reorder-id={session.id}
            data-session-owner-id={stream.id}
            data-drop-position={dropPosition ?? undefined}
            onPointerDown={(event) => beginPointerDrag(session.id, event)}
            onPointerMove={movePointerDrag}
            onPointerUp={finishPointerDrag}
            onPointerCancel={(event) => {
              if (pointerDrag.current?.pointerId !== event.pointerId) return;
              clearPointerDrag();
              window.setTimeout(() => {
                suppressClick.current = false;
              }, 0);
            }}
            onClickCapture={(event) => {
              if (!suppressClick.current) return;
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }}
            className={cn(
              sidebarSessionRowClass,
              "relative cursor-grab select-none active:cursor-grabbing",
              draggingSessionId === session.id && "opacity-50",
              dropPosition === "before" &&
                "before:pointer-events-none before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary",
              dropPosition === "after" &&
                "after:pointer-events-none after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:translate-y-1/2 after:rounded-full after:bg-primary",
              selectedSessionId === session.id && sidebarSelectedRowClass,
            )}
          >
            <button
              className="flex h-8 min-w-0 flex-1 items-center gap-2 overflow-hidden px-2 text-left focus-visible:outline-none"
              title={session.name}
              onClick={() =>
                onNavigate(`/workspaces/${stream.id}/sessions/${session.id}`)
              }
            >
              <SessionKindIcon kind={session.kind} />
              <span className="min-w-0 flex-1 truncate">{session.name}</span>
              <StatusDot status={session.status} />
              <span className="shrink-0 text-[10px]">{session.status}</span>
            </button>
            <Button
              data-session-close="true"
              size="icon-sm"
              variant="ghost"
              className="invisible mr-0.5 shrink-0 opacity-70 group-hover/session:visible focus-visible:visible"
              title={
                session.kind === "codex"
                  ? "Remove from sidebar"
                  : "Close Session"
              }
              aria-label={
                session.kind === "codex"
                  ? "Remove from sidebar"
                  : "Close Session"
              }
              onClick={(event) => {
                event.stopPropagation();
                onCloseSession(stream, session);
              }}
            >
              <X data-icon="inline-start" />
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent
            data-testid="session-context-menu"
            className="w-52"
          >
            <ContextMenuGroup>
              <ContextMenuItem
                data-testid="rename-session-action"
                onClick={() => onRenameSession(session)}
              >
                <Pencil />
                {t("sidebar.rename")}
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuContent>
        </ContextMenu>
      );
    }) ?? null
  );
}

function SidebarProjectSessions({
  project,
  selectedSessionId,
  closingSessionIds,
  onNavigate,
  onRenameSession,
  onCloseSession,
}: {
  project: ProjectDetail;
  selectedSessionId?: string;
  closingSessionIds: Set<string>;
  onNavigate: (path: string) => void;
  onRenameSession: (session: Session) => void;
  onCloseSession: (project: ProjectDetail, session: Session) => void;
}) {
  const { t } = useTranslation();
  return project.sessions
    .filter(
      (session) =>
        session.visibility === "visible" && !closingSessionIds.has(session.id),
    )
    .map((session) => {
      return (
        <ContextMenu key={session.id}>
          <ContextMenuTrigger
            data-testid={`sidebar-session-${session.id}`}
            className={cn(
              sidebarSessionRowClass,
              selectedSessionId === session.id && sidebarSelectedRowClass,
            )}
          >
            <button
              className="flex h-8 min-w-0 flex-1 items-center gap-2 overflow-hidden px-2 text-left focus-visible:outline-none"
              title={session.name}
              onClick={() =>
                onNavigate(`/projects/${project.id}/sessions/${session.id}`)
              }
            >
              <SessionKindIcon kind={session.kind} />
              <span className="min-w-0 flex-1 truncate">{session.name}</span>
              <StatusDot status={session.status} />
              <span className="shrink-0 text-[10px]">{session.status}</span>
            </button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="invisible mr-0.5 shrink-0 opacity-70 group-hover/session:visible focus-visible:visible"
              title={
                session.kind === "codex"
                  ? "Remove from sidebar"
                  : "Close Session"
              }
              aria-label={
                session.kind === "codex"
                  ? "Remove from sidebar"
                  : "Close Session"
              }
              onClick={(event) => {
                event.stopPropagation();
                onCloseSession(project, session);
              }}
            >
              <X data-icon="inline-start" />
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent
            data-testid="session-context-menu"
            className="w-52"
          >
            <ContextMenuGroup>
              <ContextMenuItem
                data-testid="rename-session-action"
                onClick={() => onRenameSession(session)}
              >
                <Pencil />
                {t("sidebar.rename")}
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuContent>
        </ContextMenu>
      );
    });
}

function SidebarForkNode(props: SidebarNodeProps) {
  const { t } = useTranslation();
  const {
    stream,
    selectedWorkspaceId,
    selectedSessionId,
    expandedWorkspaces,
    closingSessionIds,
    sessionMenu,
    onToggleWorkspace,
    onSessionMenu,
    onNavigate,
    onCreateShell,
    onCreateCodex,
    onCreateFork,
    onRenameSession,
    onReorderSessions,
    onCloseSession,
    onOpenContext,
    renderOwnerContext,
  } = props;
  const open = expandedWorkspaces.has(stream.id);
  return (
    <div className="relative">
      {renderOwnerContext(
        stream,
        <div
          data-testid="sidebar-fork-node"
          className={cn(
            sidebarTreeRowClass,
            "font-normal",
            selectedWorkspaceId === stream.id &&
              !selectedSessionId &&
              sidebarSelectedRowClass,
          )}
        >
          <button
            data-testid="sidebar-tree-toggle"
            className={sidebarTreeToggleClass}
            aria-label={`${open ? "Collapse" : "Expand"} Fork ${stream.name}`}
            aria-expanded={open}
            onClick={() => onToggleWorkspace(stream.id)}
          >
            {open ? (
              <ChevronDown
                data-testid="sidebar-tree-chevron"
                className="size-3.5"
              />
            ) : (
              <ChevronRight
                data-testid="sidebar-tree-chevron"
                className="size-3.5"
              />
            )}
          </button>
          <button
            className={sidebarTreeLinkClass}
            title={stream.name}
            onClick={() => onNavigate(`/workspaces/${stream.id}`)}
          >
            <GitBranch
              data-testid="sidebar-tree-icon"
              className={sidebarTreeIconClass}
            />
            <span
              data-testid="sidebar-node-name"
              data-sidebar-tree-label="true"
              className="min-w-0 flex-1 truncate"
            >
              {stream.name}
            </span>
          </button>
          {stream.status === "active" ? (
            <SidebarNodeActions
              menuLabel={t("sidebar.forkActions", { name: stream.name })}
              createLabel={t("sidebar.newInFork", { name: stream.name })}
              createTestId="sidebar-node-action"
              onMenu={(event) => onOpenContext(event, stream)}
              onCreate={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onSessionMenu(
                  sessionMenu?.id === stream.id
                    ? null
                    : { id: stream.id, x: rect.left, y: rect.bottom + 4 },
                );
              }}
            />
          ) : (
            <span
              data-sidebar-row-action="true"
              className="grid size-7 shrink-0 place-items-center"
              title="Archived"
            >
              <StatusDot status="closed" />
            </span>
          )}
        </div>,
      )}
      <SidebarCreateSessionMenu
        stream={stream}
        menu={sessionMenu?.id === stream.id ? sessionMenu : null}
        onSessionMenu={onSessionMenu}
        onCreateShell={onCreateShell}
        onCreateCodex={onCreateCodex}
        onCreateFork={onCreateFork}
      />
      {open && (
        <div className={sidebarTreeChildrenClass}>
          <SidebarSessions
            stream={stream}
            selectedSessionId={selectedSessionId}
            closingSessionIds={closingSessionIds}
            onNavigate={onNavigate}
            onRenameSession={onRenameSession}
            onReorderSessions={onReorderSessions}
            onCloseSession={onCloseSession}
          />
          {(!stream.sessions ||
            stream.sessions.filter(
              (session) => session.visibility === "visible",
            ).length === 0) && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground/70">
              No Sessions
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SidebarWorkspaceNode(
  props: SidebarNodeProps & { allStreams: Workspace[] },
) {
  const { t } = useTranslation();
  const {
    stream,
    allStreams,
    selectedWorkspaceId,
    selectedSessionId,
    expandedWorkspaces,
    closingSessionIds,
    sessionMenu,
    onToggleWorkspace,
    onSessionMenu,
    onNavigate,
    onCreateShell,
    onCreateCodex,
    onCreateFork,
    onRenameSession,
    onReorderSessions,
    onCloseSession,
    onOpenContext,
    renderOwnerContext,
  } = props;
  const open = expandedWorkspaces.has(stream.id);
  const forks = (stream.forks ?? [])
    .map(
      (fork) =>
        (allStreams.find((candidate) => candidate.id === fork.id) ??
          fork) as SidebarStream,
    )
    .filter((fork) => fork.status === "active");
  return (
    <div className="relative">
      {renderOwnerContext(
        stream,
        <div
          data-testid="sidebar-workspace-node"
          className={cn(
            sidebarTreeRowClass,
            "font-medium",
            selectedWorkspaceId === stream.id &&
              !selectedSessionId &&
              sidebarSelectedRowClass,
          )}
        >
          <button
            data-testid="sidebar-tree-toggle"
            className={sidebarTreeToggleClass}
            aria-label={`${open ? "Collapse" : "Expand"} Workspace ${stream.name}`}
            aria-expanded={open}
            onClick={() => onToggleWorkspace(stream.id)}
          >
            {open ? (
              <ChevronDown
                data-testid="sidebar-tree-chevron"
                className="size-3.5"
              />
            ) : (
              <ChevronRight
                data-testid="sidebar-tree-chevron"
                className="size-3.5"
              />
            )}
          </button>
          <button
            className={sidebarTreeLinkClass}
            title={stream.name}
            onClick={() => onNavigate(`/workspaces/${stream.id}`)}
          >
            <Workflow
              data-testid="sidebar-tree-icon"
              className={sidebarTreeIconClass}
            />
            <span
              data-testid="sidebar-node-name"
              data-sidebar-tree-label="true"
              className="min-w-0 flex-1 truncate"
            >
              {stream.name}
            </span>
          </button>
          {stream.status === "active" ? (
            <SidebarNodeActions
              menuLabel={t("sidebar.workspaceActions", { name: stream.name })}
              createLabel={t("sidebar.newInWorkspace", { name: stream.name })}
              createTestId="sidebar-node-action"
              onMenu={(event) => onOpenContext(event, stream)}
              onCreate={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onSessionMenu(
                  sessionMenu?.id === stream.id
                    ? null
                    : { id: stream.id, x: rect.left, y: rect.bottom + 4 },
                );
              }}
            />
          ) : (
            <span
              data-sidebar-row-action="true"
              className="grid size-7 shrink-0 place-items-center"
              title="Archived"
            >
              <StatusDot status="closed" />
            </span>
          )}
        </div>,
      )}
      <SidebarCreateSessionMenu
        stream={stream}
        menu={sessionMenu?.id === stream.id ? sessionMenu : null}
        onSessionMenu={onSessionMenu}
        onCreateShell={onCreateShell}
        onCreateCodex={onCreateCodex}
        onCreateFork={onCreateFork}
        allowFork
      />
      {open && (
        <div
          data-testid="sidebar-workspace-children"
          className={sidebarTreeChildrenClass}
        >
          <SidebarSessions
            stream={stream}
            selectedSessionId={selectedSessionId}
            closingSessionIds={closingSessionIds}
            onNavigate={onNavigate}
            onRenameSession={onRenameSession}
            onReorderSessions={onReorderSessions}
            onCloseSession={onCloseSession}
          />
          {forks.map((fork) => (
            <SidebarForkNode key={fork.id} {...props} stream={fork} />
          ))}
          {(!stream.sessions ||
            stream.sessions.filter(
              (session) => session.visibility === "visible",
            ).length === 0) &&
            forks.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground/70">
                No Sessions or Forks
              </p>
            )}
        </div>
      )}
    </div>
  );
}
