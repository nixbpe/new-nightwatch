import { Component, type ErrorInfo, type ReactNode } from "react";

import { Alert } from "./ui";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Pass false where a <main> already surrounds the boundary (e.g. AppShell's routed content). */
  landmark?: boolean;
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
        <ErrorView
          message={this.state.error.message}
          landmark={this.props.landmark}
          onRetry={() => {
            this.setState({ error: null });
          }}
        />
      );
    }
    return this.props.children;
  }
}

export function ErrorView({
  message,
  landmark,
  onRetry,
}: {
  message: string;
  landmark?: boolean;
  onRetry: () => void;
}) {
  const Wrapper = landmark === false ? "div" : "main";
  return (
    <Wrapper
      data-testid="render-error"
      className="mx-auto w-full max-w-md px-4 py-16"
    >
      <Card className="gap-4 p-6 sm:p-8">
        <h1
          data-testid="render-error-title"
          className="text-[28px] leading-9 font-semibold text-heading"
        >
          เกิดข้อผิดพลาดที่ไม่คาดคิด
        </h1>
        <Alert data-testid="render-error-message" tone="error">
          {message}
        </Alert>
        <div>
          <Button
            data-testid="render-error-retry"
            type="button"
            onClick={onRetry}
          >
            ลองใหม่
          </Button>
        </div>
      </Card>
    </Wrapper>
  );
}
