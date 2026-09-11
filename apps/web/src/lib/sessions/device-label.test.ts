import { describe, expect, it } from "vitest";

import { deviceLabel, UNKNOWN_DEVICE } from "./device-label";

const CASES: [string, string, { label: string; kind: "phone" | "desktop" }][] =
  [
    [
      "Chrome on macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      { label: "Chrome 129 · macOS", kind: "desktop" },
    ],
    [
      "Safari on iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      { label: "Safari 18 · iOS", kind: "phone" },
    ],
    [
      "Edge on Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.67",
      { label: "Edge 128 · Windows", kind: "desktop" },
    ],
    [
      "Firefox on Linux",
      "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
      { label: "Firefox 130 · Linux", kind: "desktop" },
    ],
    [
      "Chrome on Android",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
      { label: "Chrome 129 · Android", kind: "phone" },
    ],
    [
      "Chrome on iPad",
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1",
      { label: "Chrome 129 · iPadOS", kind: "desktop" },
    ],
    [
      "headless Chrome (automation) on macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.0.0 Safari/537.36",
      { label: "Chrome 149 · macOS", kind: "desktop" },
    ],
    [
      "system only",
      "SomeAgent/1.0 (Windows NT 10.0)",
      { label: "Windows", kind: "desktop" },
    ],
  ];

describe("deviceLabel", () => {
  it.each(CASES)("%s", (_name, userAgent, expected) => {
    expect(deviceLabel(userAgent)).toEqual(expected);
  });

  it("is honest about what it cannot recognise", () => {
    expect(deviceLabel("")).toEqual(UNKNOWN_DEVICE);
    expect(deviceLabel(null)).toEqual(UNKNOWN_DEVICE);
    expect(deviceLabel(undefined)).toEqual(UNKNOWN_DEVICE);
    expect(deviceLabel("curl/8.6.0")).toEqual(UNKNOWN_DEVICE);
    expect(UNKNOWN_DEVICE.label).toBe("อุปกรณ์ที่ไม่รู้จัก");
  });
});
