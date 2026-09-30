import { Card, CardHeader } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { SelectControl, TextControl, type SectionProps } from "./controls";
import { fieldId, type EditBase, type MonitorAuth } from "./model";
import {
  AUTH_TYPE_OPTIONS,
  droppedSlots,
  isAuthSlot,
  keptSlots,
  requiredSlots,
} from "./secrets";
import { SecretSlot } from "./SecretSlot";

const AUTH_DROPPED_NOTE = "ค่าลับของชนิดเดิมจะถูกลบ";
const AUTH_SLOT_PARTS = ["token", "username", "password", "apiKey"] as const;

/** The header name an auth type writes, which no header row may use as well. */
function authHeaderName(auth: MonitorAuth): string | null {
  if (auth.type === "bearer" || auth.type === "basic") return "authorization";
  return auth.type === "apiKey" ? auth.headerName.trim().toLowerCase() : null;
}

export function SecretsSection({
  values,
  errors,
  onChange,
  focusAfterRender,
  disabled,
  secrets,
  base,
}: SectionProps & { base: EditBase | null }) {
  const { auth } = values;
  const stored = new Set(base?.secretSlots ?? []);
  const slots = requiredSlots(values).filter((item) => isAuthSlot(item.slot));
  const dropped = droppedSlots(values, base).some(isAuthSlot);
  const storedInUse = keptSlots(values, base).some(isAuthSlot);
  const authName = authHeaderName(auth);
  const conflict =
    authName === null || authName === ""
      ? undefined
      : values.headers.find(
          (header) => header.name.trim().toLowerCase() === authName,
        );

  function changeType(type: MonitorAuth["type"]) {
    if (type === auth.type) return;
    secrets.drop(AUTH_SLOT_PARTS.map((part) => `auth.${part}`));
    onChange(
      {
        auth: type === "apiKey" ? { type, headerName: "" } : { type },
        replacing: values.replacing.filter((slot) => !isAuthSlot(slot)),
      },
      "auth",
    );
  }

  return (
    <Card as="section" aria-labelledby="monitor-form-auth" padding="md">
      <CardHeader id="monitor-form-auth" title="การยืนยันตัวตน" />
      <SelectControl
        path="auth.type"
        label="ชนิด"
        value={auth.type}
        error={undefined}
        disabled={disabled}
        className="max-w-56"
        onChange={(event) => {
          const next = AUTH_TYPE_OPTIONS.find(
            (option) => option.value === event.target.value,
          );
          if (next !== undefined) changeType(next.value);
        }}
      >
        {AUTH_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectControl>
      {/* In the DOM from the first render so the note is announced when it appears. */}
      <p role="status" className="text-sm text-caution">
        {dropped ? AUTH_DROPPED_NOTE : null}
      </p>
      {auth.type === "apiKey" ? (
        <TextControl
          path="auth.headerName"
          label="ชื่อ header ของ API key"
          spellCheck={false}
          value={auth.headerName}
          error={errors["auth.headerName"]}
          disabled={disabled}
          className="max-w-80"
          hint="ชื่อ header ไม่ใช่ความลับ ผู้ที่ดูมอนิเตอร์เห็นได้"
          onChange={(event) => {
            onChange(
              { auth: { type: "apiKey", headerName: event.target.value } },
              "auth.headerName",
            );
          }}
        />
      ) : null}
      {conflict === undefined ? null : (
        <p className="text-sm text-caution">
          header {conflict.name} ในส่วนคำขอชนกับการยืนยันตัวตน
          ใช้ชื่อเดียวกันไม่ได้
        </p>
      )}
      {slots.map((item, index) => (
        <SecretSlot
          key={item.slot}
          slot={item.slot}
          path={item.path}
          label={item.label}
          stored={stored.has(item.slot)}
          replacing={values.replacing.includes(item.slot)}
          error={errors[item.path] ?? (index === 0 ? errors.auth : undefined)}
          disabled={disabled}
          secrets={secrets}
          onReplace={() => {
            onChange({ replacing: [...values.replacing, item.slot] }, "auth");
            focusAfterRender(fieldId(item.path));
          }}
          onCancel={() => {
            secrets.drop([item.slot]);
            onChange(
              { replacing: values.replacing.filter((s) => s !== item.slot) },
              "auth",
            );
          }}
          onType={() => {
            onChange({}, "auth");
          }}
        />
      ))}
      {storedInUse ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-disabled={disabled}
            onClick={() => {
              if (!disabled) changeType("none");
            }}
          >
            เลิกใช้และลบค่าลับ
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
