import { Button } from "../../../components/ui/button";
import { SecretControl } from "./controls";
import { errorId, fieldId } from "./model";
import type { SecretAccess } from "./secrets";

export const SECRET_SET_TEXT = "ตั้งค่าแล้ว";
const NEW_SECRET_HINT = "ค่านี้ถูกเข้ารหัสและจะไม่แสดงอีกหลังบันทึก";
const REPLACE_HINT = "ค่าเดิมไม่แสดงอีก ถ้าไม่แทนที่จะใช้ค่าเดิมต่อ";

export const replaceButtonId = (path: string) => `${fieldId(path)}-replace`;

/**
 * One secret value (secret-replace pattern). Nothing stored: a password field.
 * Stored: "ตั้งค่าแล้ว" and a replace button that opens an empty password field.
 */
export function SecretSlot({
  slot,
  path,
  label,
  stored,
  replacing,
  error,
  disabled,
  secrets,
  onReplace,
  onCancel,
  onType,
}: {
  slot: string;
  path: string;
  label: string;
  stored: boolean;
  replacing: boolean;
  error: string | undefined;
  disabled: boolean;
  secrets: SecretAccess;
  onReplace: () => void;
  onCancel: () => void;
  onType: () => void;
}) {
  if (stored && !replacing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">
            <span className="font-medium">{label}</span>{" "}
            <span className="text-foreground-secondary">{SECRET_SET_TEXT}</span>
          </span>
          <Button
            id={replaceButtonId(path)}
            type="button"
            variant="secondary"
            size="sm"
            aria-disabled={disabled}
            aria-label={`แทนที่ ${label}`}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : errorId(path)}
            onClick={() => {
              if (!disabled) onReplace();
            }}
          >
            แทนที่
          </Button>
        </div>
        {error === undefined ? null : (
          <span id={errorId(path)} role="alert" className="text-sm text-danger">
            {error}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <SecretControl
        path={path}
        slot={slot}
        label={label}
        error={error}
        hint={stored ? REPLACE_HINT : NEW_SECRET_HINT}
        disabled={disabled}
        secrets={secrets}
        onType={onType}
      />
      {stored ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-disabled={disabled}
          aria-label={`ยกเลิกการแทนที่ ${label}`}
          onClick={() => {
            if (!disabled) onCancel();
          }}
        >
          ยกเลิกการแทนที่
        </Button>
      ) : null}
    </div>
  );
}
