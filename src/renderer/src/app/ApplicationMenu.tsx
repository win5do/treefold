import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cable, Info, LogOut, Menu, Network, RefreshCw, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AboutDialog } from "@/features/about/AboutDialog";
import { useAboutDialog } from "@/features/about/useAboutDialog";
import { agentIntegrationQuery, amuxQuery } from "@/features/app/queries";
import { AgentIntegrationPopover } from "@/features/integration/AgentIntegrationPopover";
import { AmuxResourcesPopover } from "@/features/resources/AmuxResourcesPopover";
import { desktop } from "@/lib/desktop";
import { toast } from "@/lib/toast";

export function ApplicationMenu({ onSettings }: { onSettings: () => void }) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLButtonElement>(null);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const about = useAboutDialog();
  const integration = useQuery(agentIntegrationQuery());
  const runtime = useQuery(amuxQuery());
  const integrationState = integration.error ? "unavailable" : integration.data?.state;
  const integrationWarning = !!integrationState && integrationState !== "ready";
  const runtimeWarning = !!runtime.error || runtime.data?.state === "unresponsive" || runtime.data?.state === "legacy";
  const needsAttention = integrationWarning || runtimeWarning;

  // Outside the sliding sidebar so global actions remain reachable when it is hidden.
  return <>
    <div className="fixed bottom-2 left-2 z-40">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button ref={anchor} data-testid="application-menu-trigger" size="icon" variant="ghost" className="relative bg-sidebar" aria-label={t("applicationMenu.title")} title={t("applicationMenu.title")} aria-describedby={needsAttention ? "application-menu-attention" : undefined} />}>
          <Menu data-icon />
          {needsAttention && <span data-testid="application-menu-indicator" className="absolute right-1 top-1 size-2 rounded-full bg-warning ring-2 ring-sidebar" />}
          {needsAttention && <span id="application-menu-attention" className="sr-only">{t("applicationMenu.needsAttention")}</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent data-testid="application-menu" side="top" align="start" sideOffset={8} className="w-72" finalFocus={anchor}>
          <DropdownMenuItem data-testid="open-settings" onClick={() => { anchor.current?.focus(); onSettings(); }}><Settings />{t("sidebar.settings")}</DropdownMenuItem>
          <DropdownMenuItem data-testid="open-resources" onClick={() => setResourcesOpen(true)}>
            <Network />{t("sidebar.resources")}
            {runtimeWarning && <Badge variant="warning" className="ml-auto">{t(runtime.data?.state === "legacy" ? "resources.legacy" : "resources.unresponsive")}</Badge>}
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="open-agent-integration" onClick={() => setIntegrationOpen(true)}>
            <Cable />{t("integration.title")}
            {integrationWarning && <Badge data-testid="agent-integration-indicator" variant="warning" className="ml-auto">{t(`integration.states.${integrationState!}`)}</Badge>}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!desktop} onClick={() => { anchor.current?.focus(); void about.check(); }}><RefreshCw />{t("updates.check")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { anchor.current?.focus(); about.openAbout(); }}><Info />{t("about.title")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!desktop} onClick={() => void desktop?.quit().catch(cause => toast.errorFrom(cause, t("applicationMenu.quitFailed")))}><LogOut />{t("applicationMenu.quit")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <AmuxResourcesPopover open={resourcesOpen} onOpenChange={setResourcesOpen} anchor={anchor} />
    <AgentIntegrationPopover open={integrationOpen} onOpenChange={setIntegrationOpen} anchor={anchor} />
    <AboutDialog state={about} />
  </>;
}
