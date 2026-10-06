import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectsApi } from "@/api/projects";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { compactPath } from "@/lib/compactPath";
import type { ProjectPathInspection } from "@/domain/types";
import { projectCreationError } from "./projectCreation";

export function useLocalProjectLocations(path: string, enabled: boolean) {
  const { t } = useTranslation();
  const [inspection, setInspection] = useState<ProjectPathInspection | null>(null);
  const [resolvedInput, setResolvedInput] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [primary, setPrimary] = useState("");
  const [error, setError] = useState("");
  const value = path.trim();
  useEffect(() => {
    setInspection(null); setResolvedInput(""); setSelected([]); setPrimary(""); setError("");
    if (!enabled || !value) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void projectsApi.inspectProjectPath(value, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setInspection(result);
        setSelected(result.candidates.map(item => item.path));
        setPrimary(result.candidates.find(item => item.is_git)?.path ?? "");
        setResolvedInput(value);
        if (!result.candidates.some(item => item.is_git)) setError(t("projectsUi.noGitRepositoryFound"));
      }).catch(cause => {
        if (!controller.signal.aborted) { setError(projectCreationError(cause)); setResolvedInput(value); }
      });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [enabled, value, t]);
  const current = enabled && resolvedInput === value;
  const candidates = current ? inspection?.candidates ?? [] : [];
  const chosen = candidates.filter(item => selected.includes(item.path));
  return {
    candidates, chosen, primary, setPrimary, selected,
    resolvedPath: current ? inspection?.path ?? "" : "",
    checking: enabled && Boolean(value) && !current,
    error: current ? error : "",
    ready: current && Boolean(primary) && chosen.some(item => item.is_git && item.path === primary),
    locations: [primary, ...chosen.map(item => item.path).filter(path => path !== primary)],
    toggle(path: string, checked: boolean) {
      const next = checked ? [...selected, path] : selected.filter(item => item !== path);
      setSelected(next);
      if (!next.includes(primary)) setPrimary(candidates.find(item => item.is_git && next.includes(item.path))?.path ?? "");
    },
  };
}

export function LocalProjectLocations({ discovery }: { discovery: ReturnType<typeof useLocalProjectLocations> }) {
  const { t } = useTranslation();
  if (!discovery.candidates.length) return null;
  return <FieldSet className="min-w-0 gap-2">
    <FieldLegend variant="label">{t("projectsUi.confirmLocations")}</FieldLegend>
    <RadioGroup name="primary-location" value={discovery.primary} onValueChange={value => { if (typeof value === "string") discovery.setPrimary(value); }}
      aria-label={t("projectsUi.primaryLocation")} className="min-w-0 max-h-[30vh] gap-0 overflow-y-auto rounded-lg border p-2">
      {discovery.candidates.map(candidate => <div key={candidate.path} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2">
        <Checkbox aria-label={t("projectsUi.includeLocation", { name: candidate.path })}
          checked={discovery.selected.includes(candidate.path)} onCheckedChange={checked => discovery.toggle(candidate.path, checked)} />
        <span className="min-w-0 flex-1 truncate" title={candidate.path}>
          {compactPath(candidate.path)}
          {candidate.repository_root && candidate.repository_root !== candidate.path &&
            <span className="block truncate text-muted-foreground" title={candidate.repository_root}>{t("projectsUi.repositoryRoot", { path: compactPath(candidate.repository_root) })}</span>}
        </span>
        <Badge className="shrink-0" variant={candidate.is_git ? "success" : "neutral"}>{candidate.is_git ? t("projectsUi.gitRepository") : t("projectsUi.readOnlyContext")}</Badge>
        {candidate.is_git && discovery.selected.includes(candidate.path) && <label className="flex shrink-0 items-center gap-1">
          <RadioGroupItem value={candidate.path} aria-label={t("projectsUi.creation.primaryFor", { path: candidate.path })} />
          {t("projectsUi.primaryLocation")}
        </label>}
      </div>)}
    </RadioGroup>
  </FieldSet>;
}
