import { Fragment, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Code, Copy, FolderOpen, Terminal } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  ContextMenuGroup, ContextMenuItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

export function OpenInMenu({ directoryPath, directoryName, trigger, triggerTestId = 'open-in-menu', disabled, surface = 'context' }: {
  directoryPath: string; directoryName?: string; trigger?: ReactNode; triggerTestId?: string; disabled?: boolean;
  surface?: 'context' | 'dropdown';
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const desktop = window.treefoldDesktop;
  const Sub = surface === 'dropdown' ? DropdownMenuSub : ContextMenuSub;
  const SubTrigger = surface === 'dropdown' ? DropdownMenuSubTrigger : ContextMenuSubTrigger;
  const SubContent = surface === 'dropdown' ? DropdownMenuSubContent : ContextMenuSubContent;
  const Group = surface === 'dropdown' ? DropdownMenuGroup : ContextMenuGroup;
  const Item = surface === 'dropdown' ? DropdownMenuItem : ContextMenuItem;
  const Separator = surface === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator;
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
      await desktop.openInApp(id, directoryPath);
    } catch (cause) {
      toast.errorFrom(cause, t('sidebar.openInFailed'));
    } finally { setOpening(false); }
  }
  async function copyPath() {
    try {
      await navigator.clipboard.writeText(directoryPath);
      toast.success(t('sidebar.absolutePathCopied', { name: directoryName ?? '' }));
    } catch (cause) {
      console.error('Could not copy absolute path', cause);
      toast.error(t('sidebar.copyAbsolutePathFailed'));
    }
  }
  const groups = (['fileManager', 'terminal', 'editor'] as const)
    .map(group => ({ group, apps: (apps.data ?? []).filter(app => app.group === group) }))
    .filter(group => group.apps.length > 0);
  return (
    <Sub onOpenChange={setOpen}>
      <SubTrigger data-testid={triggerTestId} disabled={disabled || opening || !desktop}>
        {trigger ?? <><FolderOpen />{t('sidebar.openIn')}</>}
      </SubTrigger>
      <SubContent data-testid="open-in-submenu" className="w-52">
        <Group>
          <Item data-testid="open-in-copy-path" onClick={() => void copyPath()}>
            <Copy />{t('sidebar.copyAbsolutePath')}
          </Item>
        </Group>
        <Separator />
        {groups.map(({ group, apps }, index) => {
          const Icon = group === 'fileManager' ? FolderOpen : group === 'terminal' ? Terminal : Code;
          return <Fragment key={group}>
            {index > 0 && <Separator />}
            <Group>
              {apps.map(app => <Item key={app.id} onClick={() => void select(app.id)}>
                <Icon />{app.label}
              </Item>)}
            </Group>
          </Fragment>;
        })}
        {apps.isError ? <Group><Item onClick={() => void apps.refetch()}>{t('sidebar.openInRetry')}</Item></Group>
          : groups.length === 0 && <Group><Item disabled>{t(apps.isPending ? 'sidebar.openInLoading' : 'sidebar.openInEmpty')}</Item></Group>}
      </SubContent>
    </Sub>
  );
}
