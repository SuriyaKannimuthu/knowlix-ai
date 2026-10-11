"use client";

/**
 * Uploads are only stored. Calibrate turns them into something chat can search:
 * text extraction, cleaning, chunking and embedding into the index, for every
 * pending document at once.
 *
 * Everything shown here is derived from the server's document statuses, so
 * deleting, replacing or a backend restart mid-run can't leave it stuck.
 */
export function CalibratePanel({
  calibrating,
  total,
  done,
  pendingCount,
  readyCount,
  lastCalibrated,
  lastFailed,
  starting,
  error,
  onCalibrate,
}: {
  calibrating: boolean;
  total: number;
  done: number;
  pendingCount: number;
  readyCount: number;
  lastCalibrated: number;
  lastFailed: number;
  starting: boolean;
  error: string | null;
  onCalibrate: (all: boolean) => void;
}) {
  if (!calibrating && pendingCount === 0 && readyCount === 0 && !error) return null;

  const recalibrateLink = (
    <button
      type="button"
      onClick={() => onCalibrate(true)}
      disabled={starting}
      className="font-mono text-[0.65rem] text-muted underline underline-offset-4 hover:text-ink disabled:opacity-50"
      title="Rebuild the search index for all your documents"
    >
      recalibrate all
    </button>
  );

  return (
    <div className="rounded-2xl border border-line bg-panel p-3.5" aria-live="polite">
      {calibrating ? (
        <>
          <div className="flex items-center justify-between font-mono text-[0.68rem] uppercase tracking-[0.14em]">
            <span>Calibrating</span>
            <span className="text-muted">
              {done} / {total}
            </span>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-ink transition-[width] duration-500"
              style={{ width: `${Math.max(6, total ? (done / total) * 100 : 6)}%` }}
            />
          </div>
          <p className="mt-2 text-[0.72rem] leading-snug text-muted">
            Extracting text, splitting it into chunks and building the search index…
            {pendingCount > 0 ? ` ${pendingCount} more will be ready to calibrate after this.` : ""}
          </p>
        </>
      ) : pendingCount > 0 ? (
        <>
          <p className="text-sm font-medium">
            {pendingCount} document{pendingCount === 1 ? "" : "s"} to calibrate
          </p>
          <p className="mt-1 text-[0.72rem] leading-snug text-muted">
            Calibrate extracts the text, splits it into chunks and indexes it, so chat can search all your
            documents together.
          </p>
          <button
            type="button"
            onClick={() => onCalibrate(false)}
            disabled={starting}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-surface shadow-[0_10px_24px_-12px_rgba(0,0,0,0.65)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5M3.4 3.4l1.8 1.8M10.8 10.8l1.8 1.8M3.4 12.6l1.8-1.8M10.8 5.2l1.8-1.8" strokeLinecap="round" />
            </svg>
            {starting ? "Starting…" : "Calibrate"}
          </button>
          {readyCount > 0 ? <div className="mt-2 text-center">{recalibrateLink}</div> : null}
        </>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <p className="text-[0.78rem] leading-snug">
            <span className="font-medium">
              {lastCalibrated > 0
                ? `✓ Calibrated ${lastCalibrated} document${lastCalibrated === 1 ? "" : "s"}.`
                : `✓ ${readyCount} document${readyCount === 1 ? "" : "s"} calibrated.`}
            </span>{" "}
            <span className="text-muted">
              {lastFailed ? `${lastFailed} failed; see the list.` : "Chat searches all of them."}
            </span>
          </p>
          <span className="shrink-0 pt-0.5">{recalibrateLink}</span>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[0.75rem] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
