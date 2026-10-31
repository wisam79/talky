import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface StudioDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  icon?: ReactNode;
  wide?: boolean;
}

function restoreTriggerFocus(dialog: HTMLDialogElement, trigger: HTMLElement | null) {
  const { activeElement, body } = dialog.ownerDocument;

  // Native close normally restores focus. Only fill in when it has nowhere to go;
  // never take focus away from another dialog or a deliberately focused control.
  if (
    trigger?.isConnected &&
    (!activeElement || activeElement === body || dialog.contains(activeElement))
  ) {
    trigger.focus({ preventScroll: true });
  }
}

export function StudioDialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  icon,
  wide = false,
}: StudioDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const activeModalRef = useRef(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isOpen) return;

    const activeElement = dialog.ownerDocument.activeElement;
    triggerRef.current =
      activeElement instanceof HTMLElement && !dialog.contains(activeElement)
        ? activeElement
        : null;
    activeModalRef.current = true;

    if (!dialog.open) dialog.showModal();

    return () => {
      activeModalRef.current = false;
      if (dialog.open) dialog.close();
      restoreTriggerFocus(dialog, triggerRef.current);
      triggerRef.current = null;
    };
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      dir="rtl"
      lang="ar"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-wide={wide ? 'true' : undefined}
      className={`studio-dialog text-start font-plex text-paper-100${wide ? ' studio-dialog-wide' : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={(event) => {
        const dialog = event.currentTarget;
        // Ignore close events queued by effect cleanup, including StrictMode replay.
        if (dialog.open || !activeModalRef.current) return;
        activeModalRef.current = false;
        restoreTriggerFocus(dialog, triggerRef.current);
        triggerRef.current = null;
        onClose();
      }}
    >
      <div className="studio-dialog-panel min-w-0">
        <header className="studio-dialog-header min-w-0">
          {icon && (
            <span
              aria-hidden="true"
              className="hidden size-11 shrink-0 items-center justify-center rounded-xl border border-ink-600 bg-ink-700 text-mist-300 sm:flex"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="break-words font-amiri text-2xl font-bold leading-[1.8]">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 break-words text-sm leading-loose text-mist-300">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق النافذة"
            className="studio-button-ghost studio-icon-button shrink-0"
          >
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>
        <div className="studio-dialog-content min-w-0">
          {children}
        </div>
      </div>
    </dialog>
  );
}
