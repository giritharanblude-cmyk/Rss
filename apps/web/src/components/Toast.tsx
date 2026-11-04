export function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  if (!message) return null;

  return (
    <div className="toast" role="status" aria-live="polite" aria-atomic="true">
      <span>{message}</span>
      <button
        type="button"
        className="toast-dismiss"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
