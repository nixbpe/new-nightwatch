import { InfoTip } from "../../components/ui/icon-button";

// One Thai sentence per term, shared by the tooltip and its aria-label (InfoTip keeps them equal).
export const TERM_TIPS = {
  kev: "KEV คือรายการช่องโหว่ที่ CISA ยืนยันแล้วว่ามีการโจมตีจริง",
  epss: "EPSS คือความน่าจะเป็นที่ช่องโหว่จะถูกโจมตีใน 30 วันข้างหน้า ยิ่งสูงยิ่งน่ากังวล",
  cvss: "CVSS คือคะแนนความรุนแรงของช่องโหว่ตั้งแต่ 0 ถึง 10 ยิ่งสูงยิ่งรุนแรง",
  vex: "VEX คือสถานะที่ผู้ดูแลระบุว่า CVE นี้กระทบ component ของเราจริงหรือไม่",
  backport:
    "backport คือกรณีที่ distro (เช่น Debian หรือ Ubuntu) แก้ช่องโหว่ในแพ็กเกจเดิมแล้วโดยเลขเวอร์ชันไม่เปลี่ยน",
  notCovered:
    "ยังไม่ครอบคลุมคือ component ที่ยังไม่มี CPE หรือ purl ที่ยืนยัน จึงยังตรวจ CVE ไม่ได้",
} as const;

export type Term = keyof typeof TERM_TIPS;

/** The info icon of a term; its tooltip and aria-label are the same sentence. */
export function TermTip({ term }: { term: Term }) {
  return <InfoTip label={TERM_TIPS[term]} data-testid={`term-${term}`} />;
}
