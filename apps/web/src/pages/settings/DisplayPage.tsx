import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Alert, Field } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { Combobox } from "../../components/ui/combobox";
import { Select } from "../../components/ui/select";
import { SectionHeader } from "../../components/ui/section-header";
import { Notice } from "../../components/ui/notice";
import { useUnsavedChangesGuard } from "../../components/ui/useUnsavedChangesGuard";
import {
  defaultPreferences,
  formatDateTime,
  usePreferences,
  type Preferences,
} from "../../lib/preferences";
import { useTheme, type ThemePreference } from "../../lib/theme";
import { Card, CardFooter, CardSection } from "../../components/ui/card";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "สว่าง" },
  { value: "dark", label: "มืด" },
  { value: "system", label: "ตามระบบ" },
];

const HOUR_CYCLES: { value: Preferences["hourCycle"]; label: string }[] = [
  { value: "h23", label: "24 ชั่วโมง (14:05)" },
  { value: "h12", label: "12 ชั่วโมง (2:05 PM)" },
];

const WEEK_STARTS: { value: Preferences["weekStart"]; label: string }[] = [
  { value: "monday", label: "จันทร์" },
  { value: "sunday", label: "อาทิตย์" },
];

type ZoneOption = { id: string; label: string; offsetMinutes: number };

function zoneOffsetMinutes(timeZone: string, at: Date): number {
  // Whole-minute precision: the parts carry no seconds, so a raw timestamp would round the offset down (GMT+6:59).
  const minute = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(minute);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
  );
  return Math.round((asUtc - minute.getTime()) / 60_000);
}

function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `GMT${sign}${String(hours)}${rest === 0 ? "" : `:${String(rest).padStart(2, "0")}`}`;
}

function zoneOptions(extras: string[]): ZoneOption[] {
  const now = new Date();
  const ids = new Set<string>(Intl.supportedValuesOf("timeZone"));
  for (const extra of extras) ids.add(extra);
  const options: ZoneOption[] = [];
  for (const id of ids) {
    try {
      const offsetMinutes = zoneOffsetMinutes(id, now);
      options.push({
        id,
        offsetMinutes,
        label: `${id} (${offsetLabel(offsetMinutes)})`,
      });
    } catch {
      // Unknown to this runtime: omit rather than mislabel.
    }
  }
  return options.sort(
    (a, b) => a.offsetMinutes - b.offsetMinutes || a.id.localeCompare(b.id),
  );
}

function samePreferences(a: Preferences, b: Preferences): boolean {
  // `language` has a single possible value today, so it is not compared.
  return (
    a.timeZone === b.timeZone &&
    a.hourCycle === b.hourCycle &&
    a.weekStart === b.weekStart
  );
}

export function DisplayPage() {
  const { theme, setTheme } = useTheme();
  const { preferences, save } = usePreferences();
  const [draft, setDraft] = useState<Preferences>(preferences);
  const [saved, setSaved] = useState<"stored" | "session-only" | null>(null);
  const [themeStored, setThemeStored] = useState(true);
  // Fixed at mount so the preview does not tick while the user compares formats.
  const [now] = useState(() => new Date());
  const zoneRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);
  const ids = {
    timeZone: useId(),
    hourCycle: useId(),
    weekStart: useId(),
  };
  const browserZone = useMemo(() => defaultPreferences().timeZone, []);
  const zones = useMemo(
    () => zoneOptions([draft.timeZone, browserZone]),
    [draft.timeZone, browserZone],
  );
  const dirty = !samePreferences(draft, preferences);
  const guard = useUnsavedChangesGuard(dirty);

  // Save and Cancel disable themselves once the draft matches; keep focus on the form.
  useEffect(() => {
    if (!dirty && restoreFocus.current) {
      restoreFocus.current = false;
      zoneRef.current?.focus();
    }
  }, [dirty]);

  const update = <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => {
    setSaved(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <Card className="divide-y divide-foreground/10">
      <CardSection aria-labelledby="theme-card-title">
        <div className="flex flex-col gap-2">
          <SectionHeader id="theme-card-title" code="01" title="ธีม" />
          <p className="text-sm text-foreground-secondary">
            มีผลทันทีกับเบราว์เซอร์นี้
            {themeStored ? " และจำไว้สำหรับครั้งถัดไป" : ""}
          </p>
          {themeStored ? null : (
            <Alert
              data-testid="display-theme-not-saved"
              tone="warning"
              role="status"
            >
              ใช้ได้เฉพาะหน้านี้ เบราว์เซอร์ไม่อนุญาตให้จำค่า
            </Alert>
          )}
        </div>
        <SegmentedControl
          optionTestId={(value) => `display-theme-${value}`}
          label="ธีม"
          value={theme}
          options={THEME_OPTIONS}
          onChange={(value) => {
            setThemeStored(setTheme(value));
          }}
        />
      </CardSection>

      <CardSection aria-labelledby="locale-card-title">
        <div className="flex flex-col gap-2">
          <SectionHeader id="locale-card-title" code="02" title="ภาษาและเวลา" />
          <p className="text-sm text-foreground-secondary">
            ใช้กับข้อความ วันที่ และเวลาที่แสดงทั่วทั้งแอป
            เก็บไว้ในเบราว์เซอร์นี้เท่านั้น
          </p>
        </div>

        {saved === "stored" ? (
          <Notice data-testid="display-saved" tone="success">
            บันทึกแล้ว ใช้กับเบราว์เซอร์นี้
          </Notice>
        ) : null}
        {saved === "session-only" ? (
          <Alert
            data-testid="display-save-not-persisted"
            tone="warning"
            role="status"
          >
            ใช้ได้เฉพาะหน้านี้ เบราว์เซอร์ไม่อนุญาตให้จำค่า
          </Alert>
        ) : null}

        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-2 block text-sm font-medium leading-none">
              ภาษา
            </span>
            <p
              data-testid="display-language"
              className="flex h-10 items-center text-base"
            >
              ไทย
            </p>
            <p className="mt-1 text-xs text-foreground-secondary">
              ตอนนี้มีภาษาไทยภาษาเดียว ภาษาอังกฤษจะเพิ่มในภายหลัง
            </p>
          </div>
          <Field
            htmlFor={ids.timeZone}
            label="โซนเวลา"
            help="เวลาทั้งหมดในรายงานและกิจกรรมจะแสดงในโซนนี้"
            helpId={`${ids.timeZone}-help`}
          >
            <Combobox
              ref={zoneRef}
              data-testid="display-time-zone"
              id={ids.timeZone}
              options={zones.map((zone) => ({
                value: zone.id,
                label: zone.label,
              }))}
              value={draft.timeZone}
              onValueChange={(timeZone) => {
                update("timeZone", timeZone);
              }}
              optionTestId={(id) => `display-zone-${id}`}
              emptyText={(query) => `ไม่พบโซนเวลา "${query}"`}
              aria-labelledby={`${ids.timeZone}-label`}
              aria-describedby={`${ids.timeZone}-help`}
            />
            {draft.timeZone === browserZone ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="display-time-zone-browser"
                className="mt-1"
                onClick={() => {
                  update("timeZone", browserZone);
                  // The button unmounts once the draft matches the browser zone.
                  zoneRef.current?.focus();
                }}
              >
                ใช้โซนของเบราว์เซอร์ ({browserZone})
              </Button>
            )}
          </Field>
          <Field htmlFor={ids.hourCycle} label="รูปแบบเวลา">
            <Select
              data-testid="display-hour-cycle"
              id={ids.hourCycle}
              value={draft.hourCycle}
              onChange={(event) => {
                update(
                  "hourCycle",
                  event.target.value === "h12" ? "h12" : "h23",
                );
              }}
            >
              {HOUR_CYCLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor={ids.weekStart} label="วันแรกของสัปดาห์">
            <Select
              data-testid="display-week-start"
              id={ids.weekStart}
              value={draft.weekStart}
              onChange={(event) => {
                update(
                  "weekStart",
                  event.target.value === "sunday" ? "sunday" : "monday",
                );
              }}
            >
              {WEEK_STARTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <p
          data-testid="display-preview"
          className="text-sm text-foreground-secondary"
        >
          ตัวอย่างเวลาตอนนี้:{" "}
          <span className="font-mono text-foreground">
            {formatDateTime(now, draft)}
          </span>
        </p>

        <CardFooter>
          <Button
            type="button"
            variant="ghost"
            data-testid="display-cancel"
            disabled={!dirty}
            onClick={() => {
              restoreFocus.current = true;
              setDraft(preferences);
              setSaved(null);
            }}
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            data-testid="display-save"
            disabled={!dirty}
            onClick={() => {
              restoreFocus.current = true;
              setSaved(save(draft) ? "stored" : "session-only");
            }}
          >
            บันทึกการเปลี่ยนแปลง
          </Button>
        </CardFooter>
      </CardSection>
      {guard}
    </Card>
  );
}
