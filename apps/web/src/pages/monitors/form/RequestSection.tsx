import {
  MONITOR_MAX_HEADERS,
  MONITOR_MAX_QUERY_PARAMS,
  MONITOR_METHODS,
} from "@nightwatch/api-contract";
import { useState } from "react";

import { Card, CardHeader } from "../../../components/ui/card";
import {
  AddRowButton,
  RowShell,
  SelectControl,
  TextareaControl,
  TextControl,
  type SectionProps,
} from "./controls";
import {
  emptyHeader,
  emptyQueryParam,
  fieldId,
  type EditBase,
  type HeaderRow,
  type MonitorMethod,
} from "./model";
import { headerSlot, storedSet } from "./secrets";
import { replaceButtonId, SecretSlot } from "./SecretSlot";

// AC-47: query parameters and the body are readable by every reader of the monitor.
const VISIBLE_WARNING =
  "ผู้ที่ดูมอนิเตอร์เห็นค่านี้ได้ ห้ามใส่ความลับ ใช้ header ลับแทน";

const ADD_HEADER_ID = fieldId("add-header");
const ADD_QUERY_ID = fieldId("add-query-param");

type Rows = "headers" | "queryParams";

export function RequestSection({
  values,
  errors,
  onChange,
  focusAfterRender,
  disabled,
  secrets,
  base,
}: SectionProps & { base: EditBase | null }) {
  const stored = storedSet(base);
  // Set when Add is pressed at the row limit; cleared when a row is removed.
  const [limit, setLimit] = useState<Rows | null>(null);

  function addRow(kind: Rows) {
    const rows = values[kind];
    const max =
      kind === "headers" ? MONITOR_MAX_HEADERS : MONITOR_MAX_QUERY_PARAMS;
    if (rows.length >= max) {
      setLimit(kind);
      return;
    }
    const added = kind === "headers" ? emptyHeader() : emptyQueryParam();
    onChange({ [kind]: [...rows, added] }, kind);
    focusAfterRender(fieldId(`${kind}.${String(rows.length)}.name`));
  }

  function removeRow(kind: Rows, index: number) {
    const removed = kind === "headers" ? values.headers[index] : undefined;
    const slot = removed?.id === undefined ? null : headerSlot(removed.id);
    if (slot !== null) secrets.drop([slot]);
    const rows = values[kind].filter((_, position) => position !== index);
    onChange(
      {
        [kind]: rows,
        ...(slot === null
          ? {}
          : { replacing: values.replacing.filter((item) => item !== slot) }),
      },
      kind,
    );
    setLimit(null);
    // The row that moved into this position, else the Add button.
    focusAfterRender(
      rows[index] !== undefined
        ? fieldId(`${kind}.${String(index)}.name`)
        : kind === "headers"
          ? ADD_HEADER_ID
          : ADD_QUERY_ID,
    );
  }

  function toggleSecret(header: HeaderRow, secret: boolean) {
    const slot = header.id === undefined ? null : headerSlot(header.id);
    // Either way the field starts empty: a typed value never moves between a visible and a secret field.
    if (slot !== null) secrets.drop([slot]);
    const index = values.headers.findIndex((item) => item.key === header.key);
    onChange(
      {
        headers: values.headers.map((item) =>
          item.key === header.key
            ? {
                ...item,
                secret,
                value: "",
                ...(secret && item.id === undefined
                  ? { id: crypto.randomUUID() }
                  : {}),
              }
            : item,
        ),
        replacing:
          slot === null
            ? values.replacing
            : values.replacing.filter((item) => item !== slot),
      },
      `headers.${String(index)}`,
    );
  }

  const bodySent = values.method !== "GET" && values.method !== "HEAD";

  return (
    <Card as="section" aria-labelledby="monitor-form-request" padding="md">
      <CardHeader id="monitor-form-request" title="คำขอ (Request)" />
      <SelectControl
        path="method"
        label="Method"
        value={values.method}
        error={errors.method}
        disabled={disabled}
        className="max-w-48"
        onChange={(event) => {
          onChange({ method: event.target.value as MonitorMethod }, "method");
        }}
      >
        {MONITOR_METHODS.map((method) => (
          <option key={method} value={method}>
            {method}
          </option>
        ))}
      </SelectControl>

      <div
        role="group"
        aria-labelledby="monitor-form-headers-title"
        className="flex flex-col gap-3"
      >
        <h3 id="monitor-form-headers-title" className="text-sm font-medium">
          Headers
        </h3>
        {values.headers.map((header, index) => {
          const row = String(index + 1);
          const path = `headers.${String(index)}`;
          return (
            <RowShell
              key={header.key}
              legend={`Header แถวที่ ${row}`}
              removeLabel={`ลบ header แถวที่ ${row}`}
              disabled={disabled}
              onRemove={() => {
                removeRow("headers", index);
              }}
            >
              <TextControl
                path={`${path}.name`}
                label="ชื่อ"
                ariaLabel={`ชื่อ header แถวที่ ${row}`}
                value={header.name}
                error={errors[`${path}.name`]}
                disabled={disabled}
                spellCheck={false}
                onChange={(event) => {
                  onChange(
                    {
                      headers: values.headers.map((item) =>
                        item.key === header.key
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    },
                    `${path}.name`,
                  );
                }}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={header.secret}
                  aria-label={`ค่าลับ header แถวที่ ${row}`}
                  aria-disabled={disabled}
                  className="h-4 w-4 accent-primary"
                  onChange={(event) => {
                    if (!disabled) toggleSecret(header, event.target.checked);
                  }}
                />
                ค่าลับ
              </label>
              {header.secret && header.id !== undefined ? (
                <SecretSlot
                  slot={headerSlot(header.id)}
                  path={`${path}.value`}
                  label={`ค่า header แถวที่ ${row}`}
                  stored={stored.has(headerSlot(header.id))}
                  replacing={values.replacing.includes(headerSlot(header.id))}
                  error={errors[`${path}.value`]}
                  disabled={disabled}
                  secrets={secrets}
                  onReplace={() => {
                    if (header.id === undefined) return;
                    onChange(
                      {
                        replacing: [...values.replacing, headerSlot(header.id)],
                      },
                      `${path}.value`,
                    );
                    focusAfterRender(fieldId(`${path}.value`));
                  }}
                  onCancel={() => {
                    if (header.id === undefined) return;
                    secrets.drop([headerSlot(header.id)]);
                    onChange(
                      {
                        replacing: values.replacing.filter(
                          (item) => item !== headerSlot(header.id ?? ""),
                        ),
                      },
                      `${path}.value`,
                    );
                    focusAfterRender(replaceButtonId(`${path}.value`));
                  }}
                  onType={() => {
                    onChange({}, `${path}.value`);
                  }}
                />
              ) : (
                <TextControl
                  path={`${path}.value`}
                  label="ค่า"
                  ariaLabel={`ค่า header แถวที่ ${row}`}
                  value={header.value}
                  error={errors[`${path}.value`]}
                  disabled={disabled}
                  spellCheck={false}
                  onChange={(event) => {
                    onChange(
                      {
                        headers: values.headers.map((item) =>
                          item.key === header.key
                            ? { ...item, value: event.target.value }
                            : item,
                        ),
                      },
                      `${path}.value`,
                    );
                  }}
                />
              )}
              {header.id !== undefined && stored.has(headerSlot(header.id)) ? (
                <p role="status" className="text-sm text-caution">
                  {header.secret ? null : "ค่าลับเดิมจะถูกลบ"}
                </p>
              ) : null}
            </RowShell>
          );
        })}
        <AddRowButton
          id={ADD_HEADER_ID}
          label="เพิ่ม header"
          limitMessage={
            errors.headers ??
            (limit === "headers"
              ? `เพิ่ม header ได้ไม่เกิน ${String(MONITOR_MAX_HEADERS)} แถว`
              : null)
          }
          disabled={disabled}
          onAdd={() => {
            addRow("headers");
          }}
        />
      </div>

      <div
        role="group"
        aria-labelledby="monitor-form-query-title"
        className="flex flex-col gap-3"
      >
        <h3 id="monitor-form-query-title" className="text-sm font-medium">
          Query params
        </h3>
        {values.queryParams.map((param, index) => {
          const row = String(index + 1);
          const path = `queryParams.${String(index)}`;
          return (
            <RowShell
              key={param.key}
              legend={`Query param แถวที่ ${row}`}
              removeLabel={`ลบ query param แถวที่ ${row}`}
              disabled={disabled}
              onRemove={() => {
                removeRow("queryParams", index);
              }}
            >
              <TextControl
                path={`${path}.name`}
                label="ชื่อ"
                ariaLabel={`ชื่อ query param แถวที่ ${row}`}
                value={param.name}
                error={errors[`${path}.name`]}
                disabled={disabled}
                spellCheck={false}
                onChange={(event) => {
                  onChange(
                    {
                      queryParams: values.queryParams.map((item) =>
                        item.key === param.key
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    },
                    `${path}.name`,
                  );
                }}
              />
              <TextControl
                path={`${path}.value`}
                label="ค่า"
                ariaLabel={`ค่า query param แถวที่ ${row}`}
                value={param.value}
                error={errors[`${path}.value`]}
                disabled={disabled}
                spellCheck={false}
                onChange={(event) => {
                  onChange(
                    {
                      queryParams: values.queryParams.map((item) =>
                        item.key === param.key
                          ? { ...item, value: event.target.value }
                          : item,
                      ),
                    },
                    `${path}.value`,
                  );
                }}
              />
            </RowShell>
          );
        })}
        <AddRowButton
          id={ADD_QUERY_ID}
          label="เพิ่ม query param"
          limitMessage={
            errors.queryParams ??
            (limit === "queryParams"
              ? `เพิ่ม query param ได้ไม่เกิน ${String(MONITOR_MAX_QUERY_PARAMS)} แถว`
              : null)
          }
          disabled={disabled}
          onAdd={() => {
            addRow("queryParams");
          }}
        />
        <p className="text-sm text-caution">{VISIBLE_WARNING}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Body</h3>
        <SelectControl
          path="bodyType"
          label="ชนิด"
          value={values.bodyType}
          error={undefined}
          disabled={disabled}
          className="max-w-48"
          onChange={(event) => {
            onChange(
              { bodyType: event.target.value === "text" ? "text" : "json" },
              "body",
            );
          }}
        >
          <option value="json">JSON</option>
          <option value="text">ข้อความ</option>
        </SelectControl>
        <TextareaControl
          path="body.content"
          label="เนื้อหา"
          value={values.bodyContent}
          error={errors["body.content"]}
          disabled={disabled}
          onChange={(event) => {
            onChange({ bodyContent: event.target.value }, "body");
          }}
        />
        {bodySent ? null : (
          <p className="text-sm text-foreground-secondary">
            method {values.method} ไม่ส่ง body
          </p>
        )}
        <p className="text-sm text-caution">{VISIBLE_WARNING}</p>
      </div>
    </Card>
  );
}
