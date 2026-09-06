import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled render error", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p role="alert" className="text-danger">
            {this.state.error.message}
          </p>
          <div>
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-on-primary"
              onClick={() => {
                this.setState({ error: null });
              }}
            >
              Try again
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
