"use client";
import { useEffect, useId, useRef } from "react";
export function CommandDialog({
  title,
  pending,
  onClose,
  children,
}: {
  title: string;
  pending: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      className="command-dialog"
    >
      <h2 id={id}>{title}</h2>
      {children}
      <button
        className="secondary-button"
        type="button"
        disabled={pending}
        onClick={onClose}
      >
        Cancel
      </button>
    </dialog>
  );
}
