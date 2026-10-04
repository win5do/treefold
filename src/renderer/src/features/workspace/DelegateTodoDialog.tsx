import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { todosApi, type TodoForkResult } from "@/api/todos";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import type { AgentKind, Todo } from "@/domain/types";
import { AgentIcon } from "@/features/agents/AgentIcon";
import { useAgentChoice } from "@/features/agents/AgentSelect";

export function DelegateTodoDialog({ todo, trigger, onClose, onCreated }: {
  todo: Todo;
  trigger: HTMLButtonElement;
  onClose: () => void;
  onCreated: (result: TodoForkResult) => void;
}) {
  const { t } = useTranslation();
  const choice = useAgentChoice();
  const id = useId();
  const selectedRef = useRef<HTMLSpanElement | null>(null);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (submitting.current || !choice.kind || choice.loading) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const result = await todosApi.createFork(todo.id, choice.kind);
      onCreated(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229
      || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    // Keep native Enter activation for the focused Cancel, Close, or Delegate button.
    if (event.target instanceof HTMLElement && event.target.closest("button")) return;
    // Radio controls consume Enter, so handle submission before it reaches them.
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) void submit();
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !submitting.current) onClose(); }}>
      <DialogContent initialFocus={() => selectedRef.current} finalFocus={() => trigger} showCloseButton={!pending} onKeyDownCapture={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t("workspaceUi.delegateTodoToFork")}</DialogTitle>
          <DialogDescription>{t("workspaceUi.delegateTodoDescription")}</DialogDescription>
        </DialogHeader>
        <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <FieldGroup>
            <FieldSet className="min-w-0">
              <FieldLegend>{t("workspaceUi.todoContent")}</FieldLegend>
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words">{todo.content}</p>
            </FieldSet>
            <FieldSet disabled={pending}>
              <FieldLegend id={`${id}-agent`}>{t("agentsUi.chooseAgent")}</FieldLegend>
              <RadioGroup aria-labelledby={`${id}-agent`} value={choice.kind ?? null}
                disabled={pending || choice.loading || !!choice.error}
                onValueChange={value => choice.select(value as AgentKind)}>
                {choice.agents.map(agent => (
                  <Field key={agent.kind} orientation="horizontal" data-disabled={pending || choice.loading || !!choice.error || !agent.available}>
                    <RadioGroupItem id={`${id}-${agent.kind}`} value={agent.kind} disabled={!agent.available}
                      ref={agent.kind === choice.kind ? selectedRef : undefined} />
                    <FieldLabel htmlFor={`${id}-${agent.kind}`}>
                      <AgentIcon kind={agent.kind} className="size-4" />
                      {agent.name}
                      {!agent.available && !choice.loading && !choice.error && <span>{t("agentsUi.notInstalled")}</span>}
                    </FieldLabel>
                  </Field>
                ))}
              </RadioGroup>
              {(choice.loading || choice.error || !choice.kind) && (
                <FieldDescription role="status">
                  {t(choice.loading ? "agentsUi.checking" : choice.error ? "agentsUi.detectionFailed" : "agentsUi.noneInstalled")}
                </FieldDescription>
              )}
            </FieldSet>
          </FieldGroup>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>{t("workspaceUi.cancel")}</Button>
            <Button type="submit" disabled={pending || choice.loading || !choice.kind}>
              {pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
              {t(pending ? "workspaceUi.delegatingTodo" : "workspaceUi.confirmDelegateTodo")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
