import { Component, type ErrorInfo, type ReactNode } from "react";

import { Alert } from "./ui";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * Render-error fallback. Used both around the whole router and around the
 * AppShell's routed content, so it is a plain centered card, never its
 * own <main>, and it sits inside the shell's landmark when nested.
 */
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
        <div className="mx-auto w-full max-w-md px-4 py-16">
          <Card className="gap-4 p-6 sm:p-8">
            <h1 className="text-xl font-semibold">
              เกิดข้อผิดพลาดที่ไม่คาดคิด
            </h1>
            <Alert tone="error">{this.state.error.message}</Alert>
            <div>
              <Button
                type="button"
                onClick={() => {
                  this.setState({ error: null });
                }}
              >
                ลองใหม่
              </Button>
            </div>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
