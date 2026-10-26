import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Open/close state for a topbar popover. It closes on a pointer-down anywhere outside `root` and on
 * Escape, which returns focus to the trigger so the keyboard isn't stranded on a removed element.
 * That Escape is `preventDefault`ed: one press closes the menu and does nothing else.
 */
export function usePopover<T extends HTMLElement = HTMLDivElement>(): {
  open: boolean;
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  root: RefObject<T>;
  trigger: RefObject<HTMLButtonElement>;
} {
  const [open, setOpen] = useState(false);
  const root = useRef<T>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // Claim the key, so other Escape handlers (leaving focus mode) leave it alone this time.
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return { open, setOpen, root, trigger };
}
