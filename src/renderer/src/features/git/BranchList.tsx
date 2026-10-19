import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import type { GitBranches, GitBranchRef } from "@/domain/types";
import { cn } from "@/lib/utils";

function BranchGroup({
  label,
  open,
  search = "",
  onOpenChange,
  children,
}: {
  label: string;
  open: boolean;
  search?: string;
  onOpenChange: () => void;
  children: React.ReactNode;
}) {
  const [collapsedSearch, setCollapsedSearch] = useState<string | null>(null);
  const expanded = search ? collapsedSearch !== search : open;

  return (
    <div>
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        onClick={() =>
          search ? setCollapsedSearch(expanded ? search : null) : onOpenChange()
        }
      >
        {expanded ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <FolderGit2 className="size-3.5 text-muted-foreground" />
        {label}
      </button>
      {expanded && (
        <div className="ml-4 border-l border-border pl-2">{children}</div>
      )}
    </div>
  );
}

export function BranchList({
  branches,
  loading = false,
  error = "",
  busy = false,
  onRefresh,
  renderBranch,
}: {
  branches: GitBranches | null;
  loading?: boolean;
  error?: string;
  busy?: boolean;
  onRefresh: () => void;
  renderBranch: (target: GitBranchRef, current: boolean) => ReactNode;
}) {
  const { t } = useTranslation();
  const [localOpen, setLocalOpen] = useState(true);
  const [remoteOpen, setRemoteOpen] = useState(true);
  const [openRemotes, setOpenRemotes] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim().toLowerCase();
  const localBranches =
    branches?.local.filter((branch) => branch.toLowerCase().includes(query)) ??
    [];
  const remotes =
    branches?.remotes
      .map((remote) => ({
        ...remote,
        branches: remote.branches.filter((branch) =>
          `${remote.name}/${branch}`.toLowerCase().includes(query),
        ),
      }))
      .filter((remote) => !query || remote.branches.length > 0) ?? [];

  return (
    <>
      <div className="flex items-center gap-2">
        <InputGroup className="flex-1">
          <InputGroupInput
            ref={searchInput}
            aria-label={t("projectsUi.searchBranches")}
            placeholder={t("projectsUi.searchBranches")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              className={cn(!search && "invisible")}
              disabled={!search}
              aria-hidden={!search}
              aria-label={t("projectsUi.clearBranchSearch")}
              title={t("projectsUi.clearBranchSearch")}
              onClick={() => {
                setSearch("");
                searchInput.current?.focus();
              }}
            >
              <X data-icon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("projectsUi.refreshBranches")}
          title={t("projectsUi.refreshBranches")}
          disabled={busy || loading}
          onClick={onRefresh}
        >
          <RefreshCw
            data-icon
            className={loading ? "animate-spin" : undefined}
          />
        </Button>
      </div>
      <div
        data-testid="repository-branches"
        aria-busy={loading}
        className="h-[min(24rem,50dvh)] shrink-0 overflow-y-auto rounded-lg border border-border p-1 [scrollbar-gutter:stable]"
      >
        {error && (
          <p role="alert" className="px-2 py-1 text-xs text-destructive">
            {error}
          </p>
        )}
        {loading && !branches ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            {t("projectsUi.loadingBranches")}
          </div>
        ) : branches &&
          query &&
          localBranches.length === 0 &&
          remotes.length === 0 ? (
          <Empty role="status" className="h-full">
            <EmptyDescription>
              {t("projectsUi.noMatchingBranches")}
            </EmptyDescription>
          </Empty>
        ) : branches ? (
          <>
            {(!query || localBranches.length > 0) && (
              <BranchGroup
                label={t("projectsUi.local")}
                open={localOpen}
                search={query}
                onOpenChange={() => setLocalOpen((value) => !value)}
              >
                {localBranches.map((branch) => (
                  <div key={branch}>
                    {renderBranch(
                      { kind: "local", branch },
                      branch === branches.current,
                    )}
                  </div>
                ))}
              </BranchGroup>
            )}
            {(!query || remotes.length > 0) && (
              <BranchGroup
                label={t("projectsUi.remote")}
                open={remoteOpen}
                search={query}
                onOpenChange={() => setRemoteOpen((value) => !value)}
              >
                {remotes.map((remote) => (
                  <BranchGroup
                    key={remote.name}
                    label={remote.name}
                    open={Boolean(openRemotes[remote.name])}
                    search={query}
                    onOpenChange={() =>
                      setOpenRemotes((current) => ({
                        ...current,
                        [remote.name]: !current[remote.name],
                      }))
                    }
                  >
                    {remote.branches.map((branch) => (
                      <div key={branch}>
                        {renderBranch(
                          { kind: "remote", remote: remote.name, branch },
                          false,
                        )}
                      </div>
                    ))}
                  </BranchGroup>
                ))}
              </BranchGroup>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
