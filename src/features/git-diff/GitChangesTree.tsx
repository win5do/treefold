import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { GitChangeFile } from "@/domain/types";
import { cn } from "@/lib/utils";

type DirectoryNode = { kind: "directory"; name: string; path: string; children: TreeNode[] };
type FileNode = { kind: "file"; name: string; path: string; file: GitChangeFile };
type TreeNode = DirectoryNode | FileNode;
type MutableDirectory = { name: string; path: string; directories: Map<string, MutableDirectory>; files: GitChangeFile[] };

type Props = {
  files: GitChangeFile[];
  allFiles: GitChangeFile[];
  stagedCount: number;
  selectedPath: string;
  mutatingPath: string;
  onSelect: (path: string) => void;
  onToggle: (file: GitChangeFile, stage: boolean) => void;
  onToggleAll: (stage: boolean) => void;
};

export function GitChangesTree({ files, allFiles, stagedCount, selectedPath, mutatingPath, onSelect, onToggle, onToggleAll }: Props) {
  const nodes = useMemo(() => buildTree(files), [files]);
  const directoryPaths = useMemo(() => collectDirectoryPaths(nodes), [nodes]);
  const directoryKey = [...directoryPaths].sort().join("\n");
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const stageableFiles = allFiles.filter((file) => file.status !== "conflicted");
  const allChecked = stageableFiles.length > 0 && stageableFiles.every((file) => !file.has_unstaged_changes);
  const allIndeterminate = !allChecked && stageableFiles.some((file) => file.has_staged_changes);

  useEffect(() => {
    setCollapsedPaths((current) => {
      const next = new Set([...current].filter((path) => directoryPaths.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [directoryKey]);

  useEffect(() => {
    if (!selectedPath) return;
    const parts = selectedPath.split("/");
    const ancestors = new Set<string>();
    for (let index = 1; index < parts.length; index += 1) ancestors.add(parts.slice(0, index).join("/"));
    setCollapsedPaths((current) => {
      if (![...ancestors].some((path) => current.has(path))) return current;
      const next = new Set(current);
      ancestors.forEach((path) => next.delete(path));
      return next;
    });
  }, [selectedPath]);

  const setDirectoryOpen = (path: string, open: boolean) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return <div className="min-h-0 flex-1 overflow-auto">
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3"><span className="ml-auto text-[10px] text-muted-foreground">{stagedCount} staged</span><span className="flex w-6 shrink-0 justify-center"><Checkbox checked={allChecked} indeterminate={allIndeterminate} disabled={Boolean(mutatingPath) || stageableFiles.length === 0} aria-label={allChecked ? "Unstage all changes" : "Stage all changes"} data-item-checkbox="true" onCheckedChange={(value) => onToggleAll(value === true)} /></span></div>
    <div role="tree" aria-label="Changed files" className="py-1">{nodes.map((node) => <TreeNodeRow key={node.path} node={node} depth={0} selectedPath={selectedPath} collapsedPaths={collapsedPaths} mutatingPath={mutatingPath} onSelect={onSelect} onToggle={onToggle} onDirectoryOpenChange={setDirectoryOpen} />)}</div>
  </div>;
}

function TreeNodeRow({ node, depth, selectedPath, collapsedPaths, mutatingPath, onSelect, onToggle, onDirectoryOpenChange }: { node: TreeNode; depth: number; selectedPath: string; collapsedPaths: Set<string>; mutatingPath: string; onSelect: (path: string) => void; onToggle: (file: GitChangeFile, stage: boolean) => void; onDirectoryOpenChange: (path: string, open: boolean) => void }) {
  if (node.kind === "directory") {
    const open = !collapsedPaths.has(node.path);
    return <Collapsible open={open} onOpenChange={(nextOpen) => onDirectoryOpenChange(node.path, nextOpen)}>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" />} role="treeitem" aria-level={depth + 1} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${node.path}`} data-directory-path={node.path} className="h-7 w-full justify-start rounded-none pr-3" style={{ paddingLeft: `${depth * 16 + 8}px` }}><ChevronRight data-icon="inline-start" className={cn("transition-transform", open && "rotate-90")} /><span className="truncate">{node.name}</span></CollapsibleTrigger>
      <CollapsibleContent role="group">{node.children.map((child) => <TreeNodeRow key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} collapsedPaths={collapsedPaths} mutatingPath={mutatingPath} onSelect={onSelect} onToggle={onToggle} onDirectoryOpenChange={onDirectoryOpenChange} />)}</CollapsibleContent>
    </Collapsible>;
  }

  const checked = !node.file.has_unstaged_changes;
  const indeterminate = node.file.has_staged_changes && node.file.has_unstaged_changes;
  const disabled = Boolean(mutatingPath) || node.file.status === "conflicted";
  const checkboxLabel = checked ? `Unstage ${node.path}` : `Stage ${node.path}`;
  return <div role="treeitem" aria-level={depth + 1} aria-selected={selectedPath === node.path} data-file-path={node.path} className={cn("flex h-7 items-center pr-3", selectedPath === node.path && "bg-accent text-accent-foreground")}>
    <Button variant="ghost" size="sm" className="h-7 min-w-0 flex-1 justify-start rounded-none pr-2" style={{ paddingLeft: `${depth * 16 + 28}px` }} aria-label={`Open diff for ${node.path}`} onClick={() => onSelect(node.path)}><span className="truncate">{node.name}</span><span className="ml-auto shrink-0 text-[10px] text-muted-foreground" title={`${node.file.additions} additions, ${node.file.deletions} deletions`}>+{node.file.additions} −{node.file.deletions}</span></Button>
    <span className="flex w-6 shrink-0 justify-center"><Checkbox checked={checked} indeterminate={indeterminate} disabled={disabled} title={checkboxLabel} aria-label={checkboxLabel} data-item-checkbox="true" data-file-path={node.path} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onCheckedChange={(value) => onToggle(node.file, value === true)} /></span>
  </div>;
}

function buildTree(files: GitChangeFile[]): TreeNode[] {
  const root: MutableDirectory = { name: "", path: "", directories: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index];
      const path = parts.slice(0, index + 1).join("/");
      let directory = current.directories.get(name);
      if (!directory) {
        directory = { name, path, directories: new Map(), files: [] };
        current.directories.set(name, directory);
      }
      current = directory;
    }
    current.files.push(file);
  }
  return directoryChildren(root);
}

function directoryChildren(directory: MutableDirectory): TreeNode[] {
  const directories: DirectoryNode[] = [...directory.directories.values()].sort((left, right) => left.name.localeCompare(right.name)).map((child) => ({ kind: "directory", name: child.name, path: child.path, children: directoryChildren(child) }));
  const files: FileNode[] = [...directory.files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => ({ kind: "file", name: file.path.split("/").at(-1) ?? file.path, path: file.path, file }));
  return [...directories, ...files];
}

function collectDirectoryPaths(nodes: TreeNode[]) {
  const paths = new Set<string>();
  const visit = (items: TreeNode[]) => {
    for (const item of items) {
      if (item.kind !== "directory") continue;
      paths.add(item.path);
      visit(item.children);
    }
  };
  visit(nodes);
  return paths;
}
