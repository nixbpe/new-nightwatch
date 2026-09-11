export type DeviceKind = "phone" | "desktop";

export type DeviceLabel = { label: string; kind: DeviceKind };

export const UNKNOWN_DEVICE: DeviceLabel = {
  label: "อุปกรณ์ที่ไม่รู้จัก",
  kind: "desktop",
};

const BROWSERS: { name: string; pattern: RegExp }[] = [
  // Order matters: Edge and Opera carry a Chrome token; Chrome carries Safari's.
  { name: "Edge", pattern: /\bEdg(?:e|A|iOS)?\/(\d+)/ },
  { name: "Opera", pattern: /\bOPR\/(\d+)/ },
  { name: "Samsung Internet", pattern: /\bSamsungBrowser\/(\d+)/ },
  { name: "Firefox", pattern: /\b(?:Firefox|FxiOS)\/(\d+)/ },
  { name: "Chrome", pattern: /\b(?:Chrome|CriOS|HeadlessChrome)\/(\d+)/ },
  { name: "Safari", pattern: /\bVersion\/(\d+)[\d.]*.*\bSafari\// },
];

const SYSTEMS: { name: string; pattern: RegExp; kind: DeviceKind }[] = [
  { name: "iOS", pattern: /\b(?:iPhone|iPod)\b/, kind: "phone" },
  { name: "iPadOS", pattern: /\biPad\b/, kind: "desktop" },
  { name: "Android", pattern: /\bAndroid\b/, kind: "phone" },
  { name: "Windows", pattern: /\bWindows\b/, kind: "desktop" },
  { name: "macOS", pattern: /\bMac OS X\b|\bMacintosh\b/, kind: "desktop" },
  { name: "ChromeOS", pattern: /\bCrOS\b/, kind: "desktop" },
  { name: "Linux", pattern: /\bLinux\b/, kind: "desktop" },
];

/**
 * Turn a session's user agent into "Chrome 129 · macOS" plus a phone/desktop
 * hint for the icon. Deliberately small: the common browsers and systems,
 * and an honest "unknown" for everything else — no dependency, no guessing.
 */
export function deviceLabel(userAgent: string | null | undefined): DeviceLabel {
  if (
    userAgent === null ||
    userAgent === undefined ||
    userAgent.trim() === ""
  ) {
    return UNKNOWN_DEVICE;
  }
  const system = SYSTEMS.find((entry) => entry.pattern.test(userAgent));
  const browser = BROWSERS.map((entry) => ({
    name: entry.name,
    match: entry.pattern.exec(userAgent),
  })).find((entry) => entry.match !== null);

  if (system === undefined && browser === undefined) {
    return UNKNOWN_DEVICE;
  }
  const browserText =
    browser === undefined
      ? null
      : browser.match?.[1] === undefined
        ? browser.name
        : `${browser.name} ${browser.match[1]}`;
  const parts = [browserText, system?.name].filter(
    (part): part is string => part !== null && part !== undefined,
  );
  return { label: parts.join(" · "), kind: system?.kind ?? "desktop" };
}
