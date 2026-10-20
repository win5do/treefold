import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { AgentKind, Session } from "@/domain/types";
import { useAgentChoice } from "@/features/agents/AgentSelect";
import { AgentChoices } from "@/features/agents/AgentChoices";
import { SessionDirectoryChoices } from "@/features/terminal/SessionDirectoryChoices";
import { handleSessionChoiceKeyboard } from "@/features/terminal/sessionChoiceKeyboard";
import { agentReviewApi } from "./api";
import type { AgentReviewTarget } from "./model";

export function AgentReviewDialog({ workspace, onClose, onCreated }: {
  workspace: AgentReviewTarget;
  onClose: () => void;
  onCreated: (session: Session) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const choice = useAgentChoice();
  const context = useQuery({ queryKey: ["agent-review", workspace.id],
    queryFn: ({ signal }) => agentReviewApi.context(workspace.id, signal), refetchOnMount: "always" });
  const [draft, setDraft] = useState<string>();
  const prompt = draft ?? (context.data?.review_prompt || t("agentReview.defaultPrompt"));
  const directories = (workspace.directories ?? []).filter(directory => directory.is_git && directory.git_status === "ready");
  const [selected, setSelected] = useState<string>();
  const directory = directories.find(item => item.id === selected) ?? directories.find(item => item.role === "primary") ?? directories[0];
  const directoryRefs = useRef(new Map<string, HTMLButtonElement>());
  const agentRefs = useRef(new Map<AgentKind, HTMLSpanElement>());
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const ready = !pending && !choice.loading && !choice.error && !!choice.kind && !!directory &&
    !!context.data && !context.isFetching && !context.error && !!prompt.trim();
  const submit = async () => {
    if (!ready || submitting.current || !choice.kind || !directory) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      onCreated(await agentReviewApi.start(workspace.id, {
        kind: choice.kind, prompt, project_directory_id: directory.id,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return <Dialog open onOpenChange={open => { if (!open && !submitting.current) onClose(); }}>
    <DialogContent className="flex h-[min(44rem,86vh)] flex-col overflow-hidden" showCloseButton={!pending}
      initialFocus={() => directory ? directoryRefs.current.get(directory.id) ?? null : null}
      onKeyDownCapture={event => {
        if (event.key === "Escape" && (event.target instanceof HTMLTextAreaElement || event.repeat)) {
          event.stopPropagation();
          if (!event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            if (event.repeat) return;
            const target = directory ? directoryRefs.current.get(directory.id) : undefined;
            (target ?? event.currentTarget).focus();
          }
          return;
        }
        handleSessionChoiceKeyboard(event, {
          directories, directoryId: directory?.id, agentKinds: choice.available.map(agent => agent.kind), agentKind: choice.kind,
          directoryRefs: directoryRefs.current, agentRefs: agentRefs.current, selectAgent: choice.select,
          submit: () => { void submit(); }, disabled: pending,
        });
      }}>
      <DialogHeader className="shrink-0">
        <DialogTitle>{t("agentReview.title")}</DialogTitle>
        <DialogDescription>{t("agentReview.description", { name: workspace.name })}</DialogDescription>
      </DialogHeader>
      <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <FieldGroup className="min-h-0 flex-1 overflow-y-auto">
          <Field data-invalid={!prompt.trim()}>
            <FieldLabel htmlFor={`${id}-prompt`}>{t("agentReview.prompt")}</FieldLabel>
            <Textarea id={`${id}-prompt`} rows={6} className="max-h-40" value={prompt} required aria-invalid={!prompt.trim()}
              disabled={pending || context.isPending || !!context.error} onChange={event => setDraft(event.target.value)} />
            <FieldDescription>{t("agentReview.promptDescription")} {t("agentReview.promptKeyboardHint")}</FieldDescription>
          </Field>
          <SessionDirectoryChoices directories={workspace.directories ?? []} agentOnly
            selectedId={directory?.id} onSelect={setSelected} disabled={pending}
            itemRef={(id, node) => { if (node) directoryRefs.current.set(id, node); else directoryRefs.current.delete(id); }} />
          <AgentChoices choice={choice} disabled={pending}
            itemRef={(kind, node) => { if (node) agentRefs.current.set(kind, node); else agentRefs.current.delete(kind); }} />
          <Field>
            <FieldLabel>{t("agentReview.range")}</FieldLabel>
            {context.isPending ? <p role="status">{t("states.checking")}</p> : context.data?.repositories.map(repository => (
              <div key={repository.repository_id} className="break-words">
                <p className="font-medium">{repository.name}</p>
                <p>{t("agentReview.reviewBranch", { branch: repository.current_branch })}</p>
                <p>{t("agentReview.comparisonBase", { branch: repository.target_branch })}</p>
              </div>
            ))}
            <FieldDescription>{t("agentReview.rangeDescription")}</FieldDescription>
            {context.error && <Button type="button" variant="secondary" onClick={() => void context.refetch()}>{t("agentReview.retry")}</Button>}
          </Field>
        </FieldGroup>
        {(error || context.error) && <Alert variant="destructive"><AlertDescription>{error || context.error?.message}</AlertDescription></Alert>}
        <p className="shrink-0 text-xs text-muted-foreground">{t("agentReview.keyboardHint")}</p>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!ready}>{pending && <Spinner data-icon="inline-start" />}{t("agentReview.start")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
