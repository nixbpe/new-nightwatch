export function HttpStatus({ status }: { status: number | undefined }) {
  return status === undefined ? null : (
    <>
      {" · "}
      <span data-testid="monitor-event-http-status" className="font-mono">
        HTTP {status}
      </span>
    </>
  );
}
