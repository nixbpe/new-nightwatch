import { MockupFrame } from "../../../components/ui/mockup-frame";
import { textInputClass } from "../../../components/ui";

const SORT_OPTIONS = [
  "ชื่อ A-Z",
  "ปัญหาก่อน",
  "ความพร้อมใช้งานต่ำสุด",
  "ตอบกลับช้าสุด",
  "เพิ่มล่าสุด",
];
const SPARK = [
  30, 44, 36, 52, 40, 33, 47, 38, 55, 42, 35, 49, 41, 37, 53, 45, 34, 48, 39,
  51, 43, 36, 46, 40,
];

// Issue 59: the list API has no sort parameter, method, interval or series yet.
export function SortMockup() {
  return (
    <MockupFrame
      label="การเรียงลำดับรายการ"
      issue={59}
      className="w-60 max-w-full self-start"
    >
      <label className="flex flex-col gap-2 text-sm">
        เรียงตาม
        <select disabled className={textInputClass} defaultValue="">
          <option value="">{SORT_OPTIONS[0]}</option>
          {SORT_OPTIONS.slice(1).map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    </MockupFrame>
  );
}

export function CardEnrichmentMockup() {
  return (
    <MockupFrame label="เมธอด ช่วงเวลาตรวจ และกราฟ 24 แท่งบนการ์ด" issue={59}>
      <div className="flex flex-col gap-2 rounded-md border border-foreground/10 p-4">
        <span className="text-[15px] font-semibold text-heading">
          บริการตัวอย่าง
        </span>
        <span className="font-mono text-xs text-foreground-secondary">
          GET https://example.com/health
        </span>
        <span className="inline-flex h-[22px] w-fit items-center rounded-full border border-foreground/20 px-2.5 text-xs text-foreground-secondary">
          ทุก <span className="mx-1 font-mono">1</span> นาที
        </span>
        <span aria-hidden="true" className="mt-1 flex h-7 items-end gap-0.5">
          {SPARK.map((height, index) => (
            <i
              key={index}
              className="flex-1 rounded-[1px] bg-foreground-secondary/60"
              style={{ height: `${String(height)}%` }}
            />
          ))}
        </span>
      </div>
    </MockupFrame>
  );
}
