import type { VulnerabilitySample } from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { SectionHeader } from "../../components/ui/section-header";
import {
  drawSample,
  fetchSample,
  reviewSampleItem,
  vulnerabilityErrorMessage,
  vulnerabilityKeys,
} from "../../lib/api/vulnerabilities";

type Scope = { organizationId: string; projectId: string };

/** Q-14 (delegated, not yet approved): over this share of the reviewed results, once enough are reviewed, the panel warns. */
const FALSE_POSITIVE_LIMIT = 0.2;
const FALSE_POSITIVE_MIN_REVIEWED = 30;

const percent = (rate: number) => `${String(Math.round(rate * 1000) / 10)}%`;

/** The false-positive baseline of Q-06: a sample of results, each marked right or wrong. */
export function SamplePanel({
  scope,
  canManage,
  hasResults,
}: {
  scope: Scope;
  canManage: boolean;
  hasResults: boolean;
}) {
  const queryClient = useQueryClient();
  const key = vulnerabilityKeys.sample(scope.organizationId, scope.projectId);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      fetchSample(scope.organizationId, scope.projectId, signal),
    retry: false,
  });
  const store = (result: { sample: VulnerabilitySample | null }) => {
    queryClient.setQueryData(key, result);
  };
  const draw = useMutation({
    mutationFn: () => drawSample(scope.organizationId, scope.projectId),
    onSuccess: store,
  });
  const review = useMutation({
    mutationFn: (input: {
      sampleId: string;
      position: number;
      verdict: "true_positive" | "false_positive";
    }) =>
      reviewSampleItem(
        scope.organizationId,
        scope.projectId,
        input.sampleId,
        input.position,
        input.verdict,
      ),
    onSuccess: store,
  });
  const sample = query.data?.sample ?? null;
  const failure =
    draw.error ?? review.error ?? (query.isError ? query.error : null);

  return (
    <section aria-labelledby="vuln-sample-heading" className="space-y-3">
      <SectionHeader
        id="vuln-sample-heading"
        title="ผลสุ่มตรวจ (baseline false positive)"
        meta="สุ่มไม่เกิน 50 รายการจากรอบล่าสุด"
      />
      {failure === null ? null : (
        <Alert tone="error" data-testid="vuln-sample-error">
          {vulnerabilityErrorMessage(failure)}
        </Alert>
      )}
      {sample === null ? (
        <p className="text-sm text-foreground-secondary">
          ยังไม่มีผลสุ่มตรวจ เกณฑ์ false positive (Q-14) ตั้งจาก baseline
          นี้ก่อน P2
        </p>
      ) : (
        <>
          <p
            className="text-sm text-foreground-secondary"
            data-testid="vuln-sample-rate"
          >
            ตรวจแล้ว{" "}
            <span className="font-mono text-foreground">{sample.reviewed}</span>{" "}
            จาก <span className="font-mono text-foreground">{sample.size}</span>{" "}
            รายการ · false positive{" "}
            <span className="font-mono text-foreground">
              {sample.falsePositiveRate === null
                ? "ไม่ทราบ"
                : `${String(sample.falsePositives)} (${percent(sample.falsePositiveRate)})`}
            </span>
          </p>
          {sample.falsePositiveRate !== null &&
          sample.reviewed >= FALSE_POSITIVE_MIN_REVIEWED &&
          sample.falsePositiveRate > FALSE_POSITIVE_LIMIT ? (
            <Alert tone="warning" data-testid="vuln-sample-over-limit">
              false positive {percent(sample.falsePositiveRate)} เกินเกณฑ์{" "}
              {percent(FALSE_POSITIVE_LIMIT)} (Q-14) ผล match ของ Project
              นี้อาจมี CVE ที่ไม่เกี่ยวข้องมากกว่าที่ยอมรับ
            </Alert>
          ) : null}
          <ul className="divide-y divide-foreground/10 rounded-md border border-foreground/10 bg-surface">
            {sample.items.map((item) => (
              <li
                key={item.position}
                data-testid={`vuln-sample-item-${String(item.position)}`}
                className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm"
              >
                <span className="font-mono text-[13px]">{item.cveId}</span>
                <span className="min-w-0 flex-1 break-words text-foreground-secondary">
                  {item.component}
                </span>
                {canManage ? (
                  <span className="inline-flex gap-2">
                    {(
                      [
                        ["true_positive", "ถูกต้อง"],
                        ["false_positive", "false positive"],
                      ] as const
                    ).map(([verdict, label]) => (
                      <Button
                        key={verdict}
                        size="sm"
                        variant={
                          item.verdict === verdict ? "default" : "outline"
                        }
                        aria-pressed={item.verdict === verdict}
                        data-testid={`vuln-sample-${verdict}-${String(item.position)}`}
                        disabled={review.isPending}
                        onClick={() => {
                          review.mutate({
                            sampleId: sample.id,
                            position: item.position,
                            verdict,
                          });
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                  </span>
                ) : (
                  <span className="text-[13px]">
                    {item.verdict === null
                      ? "ยังไม่ตรวจ"
                      : item.verdict === "true_positive"
                        ? "ถูกต้อง"
                        : "false positive"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {canManage ? (
        <Button
          variant="outline"
          data-testid="vuln-sample-draw"
          disabled={!hasResults || draw.isPending}
          onClick={() => {
            draw.mutate();
          }}
        >
          {draw.isPending ? "กำลังสุ่ม…" : "สุ่มตรวจใหม่"}
        </Button>
      ) : null}
    </section>
  );
}
