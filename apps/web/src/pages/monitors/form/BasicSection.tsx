import { MONITOR_INTERVAL_SECONDS } from "@nightwatch/api-contract";

import { Card, CardHeader } from "../../../components/ui/card";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { DOWN_AFTER_FAILURES, intervalText } from "../detail/labels";
import { TextControl, type SectionProps } from "./controls";

const INTERVAL_OPTIONS = MONITOR_INTERVAL_SECONDS.map((seconds) => ({
  value: String(seconds),
  label: `${String(seconds / 60)} นาที`,
}));

export function BasicSection({
  values,
  errors,
  onChange,
  disabled,
  advanced,
  urlNote,
}: SectionProps & {
  /** Advanced mode shows the timeout field; basic mode states the values that apply. */
  advanced: boolean;
  /** Beside the URL: why Save and Test are off (a kept secret and a new origin). */
  urlNote: string | null;
}) {
  return (
    <Card as="section" aria-labelledby="monitor-form-basic" padding="md">
      <CardHeader id="monitor-form-basic" title="ข้อมูลพื้นฐาน" />
      <TextControl
        path="name"
        label="ชื่อมอนิเตอร์"
        value={values.name}
        error={errors.name}
        disabled={disabled}
        onChange={(event) => {
          onChange({ name: event.target.value }, "name");
        }}
      />
      <TextControl
        path="url"
        label="URL"
        inputMode="url"
        placeholder="https://"
        spellCheck={false}
        value={values.url}
        error={errors.url ?? urlNote ?? undefined}
        disabled={disabled}
        onChange={(event) => {
          onChange({ url: event.target.value }, "url");
        }}
      />
      <SegmentedControl
        label="ตรวจทุก"
        value={String(values.intervalSeconds)}
        options={INTERVAL_OPTIONS}
        onChange={(value) => {
          onChange({ intervalSeconds: Number(value) }, "intervalSeconds");
        }}
      />
      {errors.intervalSeconds === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {errors.intervalSeconds}
        </p>
      )}
      {advanced ? (
        <TextControl
          path="timeoutSeconds"
          label="หมดเวลารอ (วินาที)"
          inputMode="numeric"
          value={values.timeoutSeconds}
          error={errors.timeoutSeconds}
          disabled={disabled}
          className="max-w-40"
          onChange={(event) => {
            onChange({ timeoutSeconds: event.target.value }, "timeoutSeconds");
          }}
        />
      ) : null}
      <ul className="flex flex-col gap-1 text-sm text-foreground-secondary">
        <li>
          {intervalText(values.intervalSeconds)} ถือว่าล่มเมื่อล้มเหลวติดกัน{" "}
          {DOWN_AFTER_FAILURES} ครั้ง
        </li>
        <li>ถือว่าปกติเมื่อได้รหัส {values.expectedStatus.trim()}</li>
        {advanced ? null : (
          <li>หมดเวลารอ {values.timeoutSeconds.trim()} วินาที</li>
        )}
      </ul>
    </Card>
  );
}
