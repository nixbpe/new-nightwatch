import { useQuery } from "@tanstack/react-query";

import { fetchHello } from "../lib/api/client";

export function HelloPage() {
  const hello = useQuery({ queryKey: ["hello"], queryFn: fetchHello });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">NightWatch</h1>
        <p className="text-sm text-foreground-secondary">
          Cloud security operations
        </p>
      </header>
      <section aria-live="polite" className="rounded-lg bg-surface p-6">
        {hello.isPending ? <p>Loading greeting…</p> : null}
        {hello.isError ? (
          <div role="alert" className="flex flex-col gap-1">
            <p className="font-medium text-danger">
              Could not load the greeting.
            </p>
            <p className="text-sm text-foreground-secondary">
              {hello.error.message}
            </p>
          </div>
        ) : null}
        {hello.isSuccess ? (
          <div className="flex flex-col gap-1">
            <p className="text-lg font-medium">{hello.data.message}</p>
            <p className="text-sm text-foreground-secondary">
              Server time:{" "}
              <time dateTime={hello.data.timestamp}>
                {new Date(hello.data.timestamp).toLocaleString()}
              </time>
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
