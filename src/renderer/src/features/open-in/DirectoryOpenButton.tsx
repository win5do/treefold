import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu';
import { OpenInMenu } from './OpenInMenu';

export function DirectoryOpenButton({ path, name, testId }: {
  path: string; name: string; testId: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <ContextMenu open={open} onOpenChange={setOpen}>
    <ContextMenuTrigger className="contents"><Button
      size="icon"
      variant="ghost"
      data-testid={testId}
      aria-label={t('sidebar.openIn') + ': ' + name}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen((value) => !value);
      }}
    ><Ellipsis data-icon="inline-start" /></Button></ContextMenuTrigger>
    <ContextMenuContent>
      <OpenInMenu directoryPath={path} directoryName={name} />
    </ContextMenuContent>
  </ContextMenu>;
}
