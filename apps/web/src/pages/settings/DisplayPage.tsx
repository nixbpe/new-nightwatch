import { useId, useMemo, useState } from "react";

import { MonitorIcon } from "../../components/shell/icons";
import { Alert, textInputClass } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { usePreferences, type Preferences } from "../../lib/preferences";
import { useTheme, type ThemePreference } from "../../lib/theme";

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
  // Compare at whole-minute precision: the formatted parts carry no
  // seconds, so a raw timestamp in the second half of a minute would round
  // the offset down (GMT+6:59 for Bangkok).
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

/** IANA zones sorted by current offset, labelled "City (GMT+7)". */
function zoneOptions(extra: string): ZoneOption[] {
  const now = new Date();
  const ids = new Set<string>(Intl.supportedValuesOf("timeZone"));
  ids.add(extra);
  const options: ZoneOption[] = [];
  for (const id of ids) {
    try {
      const offsetMinutes = zoneOffsetMinutes(id, now);
      const city = (id.split("/").pop() ?? id).replaceAll("_", " ");
      options.push({
        id,
        offsetMinutes,
        label: `${city} (${offsetLabel(offsetMinutes)})`,
      });
    } catch {
      // Unknown to this runtime: leave it out rather than mislabel it.
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

/**
 * Display tab: theme (shared with the account menu through useTheme) and
 * per-device language/time preferences (lib/preferences.ts). Everything
 * here is stored in this browser only, and the copy says so.
 */
export function DisplayPage() {
  const { theme, setTheme } = useTheme();
  const { preferences, save } = usePreferences();
  const [draft, setDraft] = useState<Preferences>(preferences);
  const [saved, setSaved] = useState(false);
  const ids = {
    language: useId(),
    timeZone: useId(),
    hourCycle: useId(),
    weekStart: useId(),
  };
  const zones = useMemo(() => zoneOptions(draft.timeZone), [draft.timeZone]);
  const dirty = !samePreferences(draft, preferences);

  const update = <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="theme-card-title"
        className="flex flex-col gap-4 rounded-md border border-foreground/10 bg-surface p-6"
      >
        <div>
          <h2 id="theme-card-title" className="text-base font-semibold">
            ธีม
          </h2>
          <p className="mt-1 text-sm text-foreground-secondary">
            มีผลทันทีกับอุปกรณ์นี้ และจำไว้สำหรับครั้งถัดไป
          </p>
        </div>
        <div
          role="group"
          aria-label="ธีม"
          className="inline-flex self-start gap-0.5 rounded-md border border-foreground/10 p-0.5"
        >
          {THEME_OPTIONS.map((option) => {
            const active = option.value === theme;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setTheme(option.value);
                }}
                className={`inline-flex h-8 items-center gap-2 rounded-md px-3.5 text-sm ${
                  active
                    ? "bg-foreground/8 font-medium text-foreground"
                    : "text-foreground-secondary hover:text-foreground"
                }`}
              >
                {option.value === "system" ? <MonitorIcon size={16} /> : null}
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby="locale-card-title"
        className="flex flex-col gap-5 rounded-md border border-foreground/10 bg-surface p-6"
      >
        <div>
          <h2 id="locale-card-title" className="text-base font-semibold">
            ภาษาและเวลา
          </h2>
          <p className="mt-1 text-sm text-foreground-secondary">
            ใช้กับข้อความ วันที่ และเวลาที่แสดงทั่วทั้งแอป ·
            เก็บไว้ในเบราว์เซอร์นี้เท่านั้น
          </p>
        </div>

        {saved ? (
          <Alert tone="success">บันทึกแล้ว — ใช้กับเบราว์เซอร์นี้</Alert>
        ) : null}

        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={ids.language} className="mb-1 block">
              ภาษา
            </Label>
            <select
              id={ids.language}
              value={draft.language}
              disabled
              aria-describedby={`${ids.language}-help`}
              className={textInputClass}
            >
              <option value="th">ไทย</option>
            </select>
            <p
              id={`${ids.language}-help`}
              className="mt-1 text-xs text-foreground-secondary"
            >
              ตอนนี้มีภาษาไทยภาษาเดียว — ภาษาอังกฤษจะเพิ่มในภายหลัง
            </p>
          </div>
          <div>
            <Label htmlFor={ids.timeZone} className="mb-1 block">
              โซนเวลา
            </Label>
            <select
              id={ids.timeZone}
              value={draft.timeZone}
              onChange={(event) => {
                update("timeZone", event.target.value);
              }}
              aria-describedby={`${ids.timeZone}-help`}
              className={textInputClass}
            >
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.label}
                </option>
              ))}
            </select>
            <p
              id={`${ids.timeZone}-help`}
              className="mt-1 text-xs text-foreground-secondary"
            >
              เวลาทั้งหมดในรายงานและกิจกรรมจะแสดงในโซนนี้
            </p>
          </div>
          <div>
            <Label htmlFor={ids.hourCycle} className="mb-1 block">
              รูปแบบเวลา
            </Label>
            <select
              id={ids.hourCycle}
              value={draft.hourCycle}
              onChange={(event) => {
                update(
                  "hourCycle",
                  event.target.value === "h12" ? "h12" : "h23",
                );
              }}
              className={textInputClass}
            >
              {HOUR_CYCLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={ids.weekStart} className="mb-1 block">
              วันแรกของสัปดาห์
            </Label>
            <select
              id={ids.weekStart}
              value={draft.weekStart}
              onChange={(event) => {
                update(
                  "weekStart",
                  event.target.value === "sunday" ? "sunday" : "monday",
                );
              }}
              className={textInputClass}
            >
              {WEEK_STARTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-foreground/10 pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty}
            onClick={() => {
              setDraft(preferences);
              setSaved(false);
            }}
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            disabled={!dirty}
            onClick={() => {
              save(draft);
              setSaved(true);
            }}
          >
            บันทึกการเปลี่ยนแปลง
          </Button>
        </div>
      </section>
    </div>
  );
}
