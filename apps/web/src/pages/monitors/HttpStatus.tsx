/** " · HTTP 503" after a recent-event line; nothing when the event has no status. */
export function HttpStatus({ status }: { status: number | undefined }) {
  return status === undefined ? null : (
    <>
      {" · "}
      <span className="font-mono">HTTP {status}</span>
    </>
  );
}
