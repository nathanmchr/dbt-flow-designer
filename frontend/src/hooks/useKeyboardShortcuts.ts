/**
 * @fileoverview Hook for managing keyboard shortcuts.
 */

import { useEffect } from "react";

interface KeyboardShortcut {
  /** Key to listen for */
  key: string;
  /** Whether Ctrl/Cmd is required */
  ctrlOrMeta?: boolean;
  /** Whether Shift is required */
  shift?: boolean;
  /** Callback when shortcut is triggered */
  action: () => void;
}

/**
 * Hook for registering keyboard shortcuts.
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const ctrlOrMetaPressed = e.ctrlKey || e.metaKey;
        const ctrlOrMetaMatch = shortcut.ctrlOrMeta
          ? ctrlOrMetaPressed
          : !ctrlOrMetaPressed;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;

        if (
          e.key.toLowerCase() === shortcut.key.toLowerCase() &&
          ctrlOrMetaMatch &&
          shiftMatch
        ) {
          e.preventDefault();
          shortcut.action();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}
