import type { ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OpenInMenu } from "./OpenInMenu";

export function DirectoryActionsMenu({
  path,
  name,
  label,
  testId,
  disabled,
  children,
}: {
  path: string;
  name: string;
  label?: string;
  testId: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const accessibleLabel = label ?? t("projectsUi.actionsForDirectory", { name });
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={<Button size="icon" variant="ghost" />}
        data-testid={`${testId}-trigger`}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        disabled={disabled}
      >
        <Ellipsis data-icon="inline-start" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-testid={testId}
        aria-label={accessibleLabel}
        align="end"
        className="w-56"
      >
        <OpenInMenu surface="dropdown" directoryPath={path} directoryName={name} />
        {children && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>{children}</DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
