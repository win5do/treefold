import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FieldSet, FieldLegend } from "@/components/ui/field";
import type { Directory } from "@/domain/types";
import { compactPath } from "@/lib/compactPath";

export function SessionDirectoryChoices({ directories, agentOnly, selectedId, onSelect, itemRef, disabled }: {
  directories: Directory[];
  agentOnly: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
  itemRef: (id: string, node: HTMLButtonElement | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return <FieldSet disabled={disabled}>
    <FieldLegend>{t("terminalUi.directory")}</FieldLegend>
    <div className="flex max-h-64 flex-col gap-1 overflow-y-auto" role="group"
      data-session-choice="directory" aria-label={t("terminalUi.availableDirectories")}>
      {directories.map(directory => {
        const unavailable = agentOnly && (!directory.is_git || directory.git_status !== "ready");
        return <Button key={directory.id} type="button" ref={node => itemRef(directory.id, node)}
          tabIndex={selectedId === directory.id ? 0 : -1}
          onFocus={() => onSelect(directory.id)} onClick={() => onSelect(directory.id)}
          variant={selectedId === directory.id ? "secondary" : "ghost"} className="h-auto justify-start"
          disabled={disabled || unavailable} aria-pressed={selectedId === directory.id}>
          <span className="flex min-w-0 flex-col items-start">
            <span>{directory.name}</span>
            <span className="max-w-full whitespace-normal break-all text-left text-muted-foreground" title={directory.path}>
              {compactPath(directory.path)}
              {unavailable ? t("terminalUi.agentsRequireAnAvailableGitDirectory") : ""}
            </span>
          </span>
        </Button>;
      })}
      {directories.length === 0 && <p role="status">{t("terminalUi.noDirectories")}</p>}
    </div>
  </FieldSet>;
}
