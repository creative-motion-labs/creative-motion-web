"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
  loading = false,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const titleId = useId();
  const messageId = useId();

  // Initial focus and focus restoration
  useLayoutEffect(() => {
    if (!open) return;

    // Store previously focused element
    previouslyFocusedRef.current = document.activeElement as HTMLElement;

    // Move focus to Cancel button (least destructive action)
    if (cancelButtonRef.current) {
      cancelButtonRef.current.focus();
    }

    return () => {
      // Restore focus when dialog closes
      const previous = previouslyFocusedRef.current;
      if (previous?.isConnected) {
        previous.focus();
      }
      previouslyFocusedRef.current = null;
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  // Reclaim focus when entering loading state
  useLayoutEffect(() => {
    if (!open || !loading) return;
    dialogRef.current?.focus();
  }, [open, loading]);

  // Focus trap
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
        )
      );

      // No enabled focusable elements: keep focus on dialog container
      if (focusableElements.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const activeElement = document.activeElement;

      // Focus is outside the dialog: recover by moving to first or last
      if (!dialog.contains(activeElement)) {
        e.preventDefault();
        if (e.shiftKey) {
          focusableElements[focusableElements.length - 1].focus();
        } else {
          focusableElements[0].focus();
        }
        return;
      }

      // Find current index
      const currentIndex = focusableElements.indexOf(activeElement as HTMLElement);

      // Always prevent default and explicitly cycle
      e.preventDefault();

      let targetIndex: number;
      if (e.shiftKey) {
        // Shift+Tab: move backward with wrap
        targetIndex = currentIndex <= 0
          ? focusableElements.length - 1
          : currentIndex - 1;
      } else {
        // Tab: move forward with wrap
        targetIndex = currentIndex >= focusableElements.length - 1
          ? 0
          : currentIndex + 1;
      }

      focusableElements[targetIndex].focus();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        className="w-full max-w-sm rounded-[28px] border border-rose-400/20 bg-[#0d1f3c] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-rose-400/25 bg-rose-400/10">
          <svg className="h-6 w-6 text-rose-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </div>

        <h2 id={titleId} className="text-xl font-bold text-white">{title}</h2>
        <p id={messageId} className="mt-2 text-sm leading-6 text-white/65">{message}</p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className="flex-1 rounded-2xl bg-rose-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:opacity-60"
          >
            {loading ? "Deleting…" : confirmLabel}
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="flex-1 rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
