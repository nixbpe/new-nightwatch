import { Component, type ErrorInfo, type ReactNode } from "react";

import { Alert } from "./ui";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

type ErrorBoundaryProps = {
  children: ReactNode;
  /**
   * Render the fallback as the document's <main> (default: the root
   * boundary may be all that is on the page). Pass false where a <main>
   * already surrounds the boundary, such as the AppShell's routed content.
   */
  landmark?: boolean;
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * Render-error fallback: a centered card. Around the whole router it is the
 * page's <main>; nested inside the AppShell (landmark={false}) it is a
 * plain block inside the shell's own <main>.
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
      const Wrapper = this.props.landmark === false ? "div" : "main";
      return (
        <Wrapper className="mx-auto w-full max-w-md px-4 py-16">
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
        </Wrapper>
      );
    }
    return this.props.children;
  }
}
