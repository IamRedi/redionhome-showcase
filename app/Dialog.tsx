import { messages as m } from "./i18n/index.ts";
import { useEffect, useRef, useId, useContext, type ReactNode } from "react";
import { X } from "lucide-react";
import {AIEntry,AIEntryContext} from './AIEntry.tsx';
export function Dialog({
  title,
  eyebrow,
  children,
  onClose,
  suspended = false,
  className = "",
  assistant = false,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  onClose: () => void;
  suspended?: boolean;
  className?: string;
  assistant?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const lastFocus=useRef<HTMLElement|null>(null);
  const titleId=useId();
  const ai=useContext(AIEntryContext);
  const paused=suspended||(!assistant&&!!ai?.active);
  useEffect(() => {
    const dialog = ref.current!;
    if (!paused) {dialog.showModal();lastFocus.current?.focus({preventScroll:true});}
    else dialog.close();
    return () => {
      if(dialog.contains(document.activeElement))lastFocus.current=document.activeElement as HTMLElement;
      dialog.close();
    };
  }, [paused]);
  return (
    <dialog
      ref={ref}
      className={`sheet ${className}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="sheet-inner">
        <header className="sheet-head">
          {!assistant&&<AIEntry/>}
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label={m.closePanel}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
