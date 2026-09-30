import { MONITOR_MAX_ASSERTIONS } from "@nightwatch/api-contract";
import { useState } from "react";

import { Card, CardHeader } from "../../../components/ui/card";
import { ASSERTION_KIND_LABELS } from "../detail/labels";
import {
  AddRowButton,
  RowShell,
  SelectControl,
  TextControl,
  type SectionProps,
} from "./controls";
import { emptyAssertion, fieldId, type AssertionKind } from "./model";

const KINDS = [
  "jsonPathEquals",
  "bodyContains",
  "responseTimeBelow",
] as const satisfies readonly AssertionKind[];

const ADD_ID = fieldId("add-assertion");

export function AssertionsSection({
  values,
  errors,
  onChange,
  focusAfterRender,
  disabled,
}: SectionProps) {
  const [atLimit, setAtLimit] = useState(false);

  function update(
    key: string,
    patch: Partial<(typeof values.assertions)[number]>,
    path: string,
  ) {
    onChange(
      {
        assertions: values.assertions.map((item) =>
          item.key === key ? { ...item, ...patch } : item,
        ),
      },
      path,
    );
  }

  return (
    <Card as="section" aria-labelledby="monitor-form-assertions" padding="md">
      <CardHeader
        id="monitor-form-assertions"
        title="เงื่อนไขตรวจสอบ (Assertions)"
      />
      <TextControl
        path="expectedStatus"
        label="รหัสสถานะที่ถือว่าปกติ"
        value={values.expectedStatus}
        error={errors.expectedStatus}
        disabled={disabled}
        spellCheck={false}
        className="max-w-72"
        hint="รหัสเดี่ยว ช่วง หรือรายการ เช่น 200-299,301"
        onChange={(event) => {
          onChange({ expectedStatus: event.target.value }, "expectedStatus");
        }}
      />
      {values.assertions.map((assertion, index) => {
        const row = String(index + 1);
        const path = `assertions.${String(index)}`;
        return (
          <RowShell
            key={assertion.key}
            legend={`เงื่อนไขแถวที่ ${row}`}
            removeLabel={`ลบเงื่อนไขแถวที่ ${row}`}
            disabled={disabled}
            onRemove={() => {
              const rest = values.assertions.filter(
                (item) => item.key !== assertion.key,
              );
              onChange({ assertions: rest }, "assertions");
              setAtLimit(false);
              focusAfterRender(
                rest[index] === undefined
                  ? ADD_ID
                  : fieldId(`assertions.${String(index)}.kind`),
              );
            }}
          >
            <SelectControl
              path={`${path}.kind`}
              label="ชนิด"
              ariaLabel={`ชนิดเงื่อนไขแถวที่ ${row}`}
              value={assertion.kind}
              error={errors[`${path}.kind`]}
              disabled={disabled}
              onChange={(event) => {
                const kind = KINDS.find((item) => item === event.target.value);
                if (kind !== undefined) update(assertion.key, { kind }, path);
              }}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {ASSERTION_KIND_LABELS[kind]}
                </option>
              ))}
            </SelectControl>
            {assertion.kind === "jsonPathEquals" ? (
              <>
                <TextControl
                  path={`${path}.path`}
                  label="JSONPath"
                  ariaLabel={`JSONPath แถวที่ ${row}`}
                  placeholder="$.status"
                  value={assertion.path}
                  error={errors[`${path}.path`]}
                  disabled={disabled}
                  spellCheck={false}
                  hint="รองรับ $, .name, ['name'] และ [index] เท่านั้น"
                  onChange={(event) => {
                    update(
                      assertion.key,
                      { path: event.target.value },
                      `${path}.path`,
                    );
                  }}
                />
                <TextControl
                  path={`${path}.expected`}
                  label="ค่าที่คาดหวัง"
                  ariaLabel={`ค่าที่คาดหวังแถวที่ ${row}`}
                  value={assertion.expected}
                  error={errors[`${path}.expected`]}
                  disabled={disabled}
                  spellCheck={false}
                  hint={
                    "ตัวเลข true false null หรือข้อความในเครื่องหมายคำพูด ค่าอื่นเทียบเป็นข้อความ"
                  }
                  onChange={(event) => {
                    update(
                      assertion.key,
                      { expected: event.target.value },
                      `${path}.expected`,
                    );
                  }}
                />
              </>
            ) : null}
            {assertion.kind === "bodyContains" ? (
              <TextControl
                path={`${path}.text`}
                label="ข้อความที่ต้องมี"
                ariaLabel={`ข้อความที่ต้องมีแถวที่ ${row}`}
                value={assertion.text}
                error={errors[`${path}.text`]}
                disabled={disabled}
                onChange={(event) => {
                  update(
                    assertion.key,
                    { text: event.target.value },
                    `${path}.text`,
                  );
                }}
              />
            ) : null}
            {assertion.kind === "responseTimeBelow" ? (
              <TextControl
                path={`${path}.ms`}
                label="น้อยกว่า (มิลลิวินาที)"
                ariaLabel={`เวลาตอบสนองน้อยกว่าแถวที่ ${row} (มิลลิวินาที)`}
                inputMode="numeric"
                value={assertion.ms}
                error={errors[`${path}.ms`]}
                disabled={disabled}
                className="max-w-48"
                onChange={(event) => {
                  update(
                    assertion.key,
                    { ms: event.target.value },
                    `${path}.ms`,
                  );
                }}
              />
            ) : null}
          </RowShell>
        );
      })}
      <AddRowButton
        id={ADD_ID}
        label="เพิ่มเงื่อนไข"
        limitMessage={
          errors.assertions ??
          (atLimit
            ? `เพิ่มเงื่อนไขได้ไม่เกิน ${String(MONITOR_MAX_ASSERTIONS)} ข้อ`
            : null)
        }
        disabled={disabled}
        onAdd={() => {
          if (values.assertions.length >= MONITOR_MAX_ASSERTIONS) {
            setAtLimit(true);
            return;
          }
          onChange(
            {
              assertions: [
                ...values.assertions,
                emptyAssertion("jsonPathEquals"),
              ],
            },
            "assertions",
          );
          focusAfterRender(
            fieldId(`assertions.${String(values.assertions.length)}.kind`),
          );
        }}
      />
    </Card>
  );
}
