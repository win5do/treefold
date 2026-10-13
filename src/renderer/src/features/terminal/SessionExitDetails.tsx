import { useTranslation } from "react-i18next";
import type { Session } from "@/domain/types";

export function SessionExitDetails({ session }: { session: Session }) {
  const { t } = useTranslation();
  return <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-terminal-muted">
    <div className="flex items-baseline gap-2">
      <dt>{t("terminalUi.exitCode")}</dt>
      <dd className="font-mono text-terminal-foreground">{session.exit_code ?? t("terminalUi.exitCodeUnknown")}</dd>
    </div>
    {session.exit_signal && <div className="flex items-baseline gap-2">
      <dt>{t("terminalUi.exitSignal")}</dt>
      <dd className="font-mono text-terminal-foreground">{session.exit_signal}</dd>
    </div>}
  </dl>;
}
