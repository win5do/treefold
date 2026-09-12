import { Fragment, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Code, FolderOpen, Terminal } from 'lucide-react';
import type { ProjectDetail } from '@/domain/types';
import { workspaceDetailQuery } from '@/features/workspace/queries';
import { toast } from '@/lib/toast';
import {
  ContextMenuGroup, ContextMenuItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
} from '@/components/ui/context-menu';

export function OpenInMenu({ project, workspaceId, disabled }: {
  project: ProjectDetail; workspaceId?: string; disabled: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const desktop = window.treefoldDesktop;
  const apps = useQuery({
    queryKey: ['desktop', 'open-in-apps'],
    queryFn: () => desktop!.listOpenInApps(),
    enabled: open && Boolean(desktop),
    staleTime: 0,
    retry: false,
  });
  async function select(id: string) {
    if (!desktop || opening) return;
    setOpening(true);
    try {
      const directory = workspaceId
        ? (await client.fetchQuery(workspaceDetailQuery(workspaceId))).checkout_path
        : project.directories.find(item => item.id === project.default_directory_id)?.path;
      if (!directory) throw new Error(t('sidebar.openDirectoryUnavailable'));
      await desktop.openInApp(id, directory);
    } catch (cause) {
      toast.errorFrom(cause, t('sidebar.openInFailed'));
    } finally { setOpening(false); }
  }
  const groups = (['fileManager', 'editor', 'terminal'] as const)
    .map(group => ({ group, apps: (apps.data ?? []).filter(app => app.group === group) }))
    .filter(group => group.apps.length > 0);
  return (
    <ContextMenuSub onOpenChange={setOpen}>
      <ContextMenuSubTrigger data-testid="open-in-menu" disabled={disabled || opening || !desktop}>
        <FolderOpen />{t('sidebar.openIn')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent data-testid="open-in-submenu" className="w-52">
        {groups.map(({ group, apps }, index) => {
          const Icon = group === 'fileManager' ? FolderOpen : group === 'terminal' ? Terminal : Code;
          return <Fragment key={group}>
            {index > 0 && <ContextMenuSeparator />}
            <ContextMenuGroup>
              {apps.map(app => <ContextMenuItem key={app.id} onClick={() => void select(app.id)}>
                <Icon />{app.label}
              </ContextMenuItem>)}
            </ContextMenuGroup>
          </Fragment>;
        })}
        {apps.isError ? <ContextMenuGroup><ContextMenuItem onClick={() => void apps.refetch()}>{t('sidebar.openInRetry')}</ContextMenuItem></ContextMenuGroup>
          : groups.length === 0 && <ContextMenuGroup><ContextMenuItem disabled>{t(apps.isPending ? 'sidebar.openInLoading' : 'sidebar.openInEmpty')}</ContextMenuItem></ContextMenuGroup>}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
