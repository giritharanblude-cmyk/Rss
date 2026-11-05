export function LoadingState({ label }: { label: string }) {
  return (
    <div className="loading-state" role="status">
      <span>{label}</span>
      <div className="loading-skeletons" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
