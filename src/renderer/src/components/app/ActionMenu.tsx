import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { createPortal } from "react-dom";
import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ActionMenu({
  label,
  testId,
  disabled,
  children,
}: {
  label: string;
  testId: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusMenuRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  const show = (focusMenu = false) => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    focusMenuRef.current = focusMenu;
    setPosition({
      left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)),
      top: rect.bottom + 4,
    });
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !triggerRef.current) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(
        triggerRect.right - menuRect.width,
        window.innerWidth - menuRect.width - 8,
      ),
    );
    const below = triggerRect.bottom + 4;
    const top =
      below + menuRect.height <= window.innerHeight - 8
        ? below
        : Math.max(8, triggerRect.top - menuRect.height - 4);
    setPosition((current) =>
      current.left === left && current.top === top ? current : { left, top },
    );
    if (focusMenuRef.current) {
      menuRef.current
        .querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
      focusMenuRef.current = false;
    }
  }, [open, position.left, position.top]);

  useEffect(() => {
    if (!open) return;
    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const closeFromViewportChange = () => setOpen(false);
    document.addEventListener("pointerdown", closeFromPointer);
    document.addEventListener("keydown", closeFromKeyboard);
    window.addEventListener("resize", closeFromViewportChange);
    window.addEventListener("scroll", closeFromViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeFromPointer);
      document.removeEventListener("keydown", closeFromKeyboard);
      window.removeEventListener("resize", closeFromViewportChange);
      window.removeEventListener("scroll", closeFromViewportChange, true);
    };
  }, [open]);

  const navigateMenu = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (index + 1) % items.length
            : (index <= 0 ? items.length : index) - 1;
    items[next]?.focus();
  };

  return (
    <>
      <Button
        ref={triggerRef}
        data-testid={`${testId}-trigger`}
        size="icon"
        variant="ghost"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            open
              ? menuRef.current
                  ?.querySelector<HTMLButtonElement>(
                    '[role="menuitem"]:not(:disabled)',
                  )
                  ?.focus()
              : show(true);
          }
        }}
      >
        <Ellipsis data-icon="inline-start" />
      </Button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            data-testid={testId}
            data-overlay-root="true"
            role="menu"
            aria-label={label}
            className="fixed z-[100] w-56 rounded-lg border border-border bg-card p-1 shadow-xl"
            style={position}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('[role="menuitem"]'))
                setOpen(false);
            }}
            onKeyDown={navigateMenu}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

export function ActionMenuItem({
  icon,
  children,
  disabled,
  blocked,
  testId,
  title,
  variant = "default",
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  blocked?: boolean;
  testId?: string;
  title?: string;
  variant?: "default" | "destructive";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      data-variant={variant}
      data-blocked={blocked || undefined}
      disabled={disabled}
      title={title}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
        blocked
          ? "cursor-not-allowed text-muted-foreground hover:bg-muted focus-visible:bg-muted"
          : variant === "destructive"
            ? "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10"
            : "hover:bg-muted focus-visible:bg-muted",
      )}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

