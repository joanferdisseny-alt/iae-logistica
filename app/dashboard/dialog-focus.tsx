"use client";
import { useEffect, useId, useRef } from "react";

export function DialogFocus() {
  const marker = useRef<HTMLSpanElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = marker.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const title = dialog.querySelector<HTMLElement>("h2");
    if (title && !dialog.getAttribute("aria-labelledby")) {
      title.id ||= titleId;
      dialog.setAttribute("aria-labelledby", title.id);
    }
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')).filter(element => element.getClientRects().length > 0);
    dialog.tabIndex = -1;
    (focusable()[0] ?? dialog).focus();
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dialog.querySelector<HTMLButtonElement>(".ec-modal-header button")?.click();
      }
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0] ?? dialog;
        const last = elements[elements.length - 1] ?? dialog;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    dialog.addEventListener("keydown", onKey);
    return () => {
      dialog.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [titleId]);
  return <span hidden ref={marker} />;
}
