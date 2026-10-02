import { useEffect, useRef } from "react";

import { Card } from "../../components/ui/card";

// Step 15: the card heading takes focus so a screen reader announces why the rows went away.
export function AuditDenied({ message }: { message: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <Card as="section" padding="md" aria-labelledby="audit-denied-title">
      <h2
        id="audit-denied-title"
        ref={heading}
        tabIndex={-1}
        className="w-fit rounded-[4px] text-base font-semibold text-heading outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        เข้าถึงบันทึกกิจกรรมไม่ได้
      </h2>
      <p className="text-sm text-foreground-secondary">{message}</p>
    </Card>
  );
}
