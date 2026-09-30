import type { MonitorRecord } from "@nightwatch/api-contract";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { Link, useNavigate } from "react-router";

import { ArrowLeftIcon } from "../../../components/shell/icons";
import { Page, PageHeader } from "../../../components/shell/Page";
import { PageState } from "../../../components/shell/PageState";
import { Alert } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { ApiError } from "../../../lib/api/client";
import {
  createMonitor,
  fetchMonitorDetail,
  monitorQueryKeys,
  testMonitorDraft,
  testMonitorEdit,
  updateMonitor,
} from "../../../lib/api/monitors";
import { ROLE_LABELS } from "../../../lib/roles";
import { useTenant } from "../../../lib/tenant/TenantProvider";
import type { MonitorFlashState } from "../flash";
import { AssertionsSection } from "./AssertionsSection";
import { BasicSection } from "./BasicSection";
import { RequestSection } from "./RequestSection";
import { TestPanel } from "./TestPanel";
import { SecretsSection } from "./SecretsSection";
import {
  ADVANCED_ONLY_PATH,
  advancedCount,
  createPayload,
  defaultValues,
  editBaseFromRecord,
  editPayload,
  placeErrors,
  SECRET_ORIGIN_MESSAGE,
  secretOriginChanged,
  serverFieldErrors,
  testCreatePayload,
  testEditPayload,
  URL_BLOCKED_MESSAGE,
  validateValues,
  valuesFromRecord,
  type EditBase,
  type FieldErrors,
  type FormValues,
} from "./model";

export const ROLE_CHANGED = "สิทธิ์ของคุณเปลี่ยนแล้ว";
const DENIED_MESSAGE = "คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้";
const CONFLICT_MESSAGE =
  "มอนิเตอร์นี้ถูกแก้โดยผู้อื่น โหลดใหม่เพื่อดูค่าล่าสุด";
const ORIGIN_BLOCK_NOTE =
  "การแก้ค่าลับจะทำได้ในส่วนค่าลับ (ยังไม่เปิดใช้) จึงยังบันทึกหรือทดสอบไม่ได้";

type Mode = "basic" | "advanced";

// Errors of a Test that describe the form, its permission or its monitor; anything else is the service's.
const FORM_ERROR_CODES: ReadonlySet<string> = new Set([
  "MONITOR_INVALID",
  "MONITOR_TARGET_BLOCKED",
  "MONITOR_SECRET_ORIGIN_CHANGED",
  "MONITOR_NOT_FOUND",
  "PERMISSION_DENIED",
  "MEMBERSHIP_DENIED",
]);

export function MonitorForm({
  organization,
  monitorId,
  record,
  roleLost,
  onReload,
}: {
  organization: { id: string; name: string; role: string };
  /** Set with `record` on Edit. */
  monitorId?: string;
  record?: MonitorRecord;
  /** The role no longer allows writing: the form stays, with its values, and its actions are off. */
  roleLost: boolean;
  onReload?: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { serverActiveOrgId, refreshMembershipContext } = useTenant();
  const organizationId = organization.id;

  // Pinned when the form opens: a refetch must not change what a save is checked against.
  const [initial] = useState(() => ({
    values: record === undefined ? defaultValues() : valuesFromRecord(record),
    base: record === undefined ? null : editBaseFromRecord(record),
    title: record?.name ?? null,
  }));
  const base: EditBase | null = initial.base;
  const editing = base !== null && monitorId !== undefined;
  const [values, setValues] = useState<FormValues>(initial.values);
  const [mode, setMode] = useState<Mode>(
    advancedCount(initial.values) > 0 ? "advanced" : "basic",
  );
  // One id per form session, kept across retries of the same submission.
  const [clientRequestId] = useState(() => crypto.randomUUID());

  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const latestOrg = useRef(serverActiveOrgId);
  latestOrg.current = serverActiveOrgId;
  const mounted = useRef(true);

  useEffect(() => {
    headingRef.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);

  // Validation reruns on every render, so a fixed field loses its error at once.
  const clientErrors = useMemo(
    () => (showErrors ? validateValues(values) : {}),
    [showErrors, values],
  );
  const allErrors = { ...clientErrors, ...serverErrors };
  const { placed, unplaced } = placeErrors(allErrors, values);

  const originBlocked = secretOriginChanged(base, values);
  const blockedReason = roleLost
    ? ROLE_CHANGED
    : originBlocked
      ? SECRET_ORIGIN_MESSAGE
      : null;
  const controlsOff = saving || roleLost;

  useEffect(() => {
    if (focusToken === 0) return;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  }, [focusToken]);

  useEffect(() => {
    if (focusTarget === null) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  function change(patch: Partial<FormValues>, clearPrefix: string) {
    setValues((current) => ({ ...current, ...patch }));
    setServerErrors((current) => {
      const kept = Object.entries(current).filter(
        ([path]) => path !== clearPrefix && !path.startsWith(`${clearPrefix}.`),
      );
      return kept.length === Object.keys(current).length
        ? current
        : Object.fromEntries(kept);
    });
  }

  function showFirstInvalid(errors: FieldErrors) {
    setShowErrors(true);
    // An advanced field has nothing to focus while the form is in basic mode.
    if (Object.keys(errors).some((path) => ADVANCED_ONLY_PATH.test(path))) {
      setMode("advanced");
    }
    setFocusToken((token) => token + 1);
  }

  function refreshContext() {
    void refreshMembershipContext();
  }

  /** Puts a server refusal where the user can act on it. Raw server text is never shown. */
  function handleError(error: unknown, failure: string): boolean {
    if (!(error instanceof ApiError)) {
      setFormError(failure);
      return false;
    }
    switch (error.code) {
      case "MONITOR_INVALID": {
        const fields = serverFieldErrors(error.details);
        if (fields === null || Object.keys(fields).length === 0) {
          setFormError("ค่าที่กรอกไม่ถูกต้อง ตรวจสอบและลองอีกครั้ง");
          return true;
        }
        setServerErrors(fields);
        showFirstInvalid(fields);
        return true;
      }
      case "MONITOR_TARGET_BLOCKED":
        setServerErrors({ url: URL_BLOCKED_MESSAGE });
        showFirstInvalid({ url: URL_BLOCKED_MESSAGE });
        return true;
      case "MONITOR_SECRET_ORIGIN_CHANGED":
        setServerErrors({ url: SECRET_ORIGIN_MESSAGE });
        showFirstInvalid({ url: SECRET_ORIGIN_MESSAGE });
        return true;
      case "MONITOR_NOT_FOUND":
        setNotFound(true);
        return true;
      case "PERMISSION_DENIED":
        setFormError(ROLE_CHANGED);
        refreshContext();
        return true;
      case "MEMBERSHIP_DENIED":
        setFormError(DENIED_MESSAGE);
        refreshContext();
        return true;
      case "MONITOR_VERSION_CONFLICT":
        setConflict(true);
        return true;
      case "MONITOR_LIMIT_REACHED":
        setFormError("องค์กรนี้มีมอนิเตอร์ครบตามจำนวนสูงสุดแล้ว เพิ่มไม่ได้");
        return true;
      default:
        setFormError(failure);
        return true;
    }
  }

  /** Refusals that belong to the form; a service failure stays in the Test panel. */
  function handleTestError(error: unknown): boolean {
    if (!(error instanceof ApiError) || !FORM_ERROR_CODES.has(error.code)) {
      return false;
    }
    return handleError(error, "ทดสอบไม่สำเร็จ ลองอีกครั้ง");
  }

  function validateForTest(): boolean {
    const errors = validateValues(values);
    if (Object.keys(errors).length === 0) return true;
    showFirstInvalid(errors);
    return false;
  }

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    if (saveInFlight.current || testing || controlsOff || originBlocked) return;
    const errors = validateValues(values);
    if (Object.keys(errors).length > 0) {
      showFirstInvalid(errors);
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    setFormError(null);
    setConflict(false);
    try {
      const saved = editing
        ? await updateMonitor(
            organizationId,
            monitorId,
            editPayload(values, base),
          )
        : await createMonitor(
            organizationId,
            createPayload(values, clientRequestId),
          );
      await queryClient.invalidateQueries({
        queryKey: monitorQueryKeys.all(organizationId),
        refetchType: "none",
      });
      if (editing) {
        // Detail must not paint the pre-edit health for a frame: it starts from a fresh read.
        await queryClient
          .query({
            queryKey: monitorQueryKeys.detail(organizationId, monitorId),
            queryFn: () => fetchMonitorDetail(organizationId, monitorId),
            staleTime: 0,
          })
          .catch(() => {
            queryClient.removeQueries({
              queryKey: monitorQueryKeys.detail(organizationId, monitorId),
            });
          });
      }
      // A save that lands after the Organization was switched must not pull the user back.
      if (
        !mounted.current ||
        (latestOrg.current !== null && latestOrg.current !== organizationId)
      ) {
        return;
      }
      void navigate(
        `/organizations/${organizationId}/monitors/${saved.monitor.id}`,
        {
          state: {
            notice: editing ? "updated" : "created",
          } satisfies MonitorFlashState,
        },
      );
    } catch (error) {
      handleError(error, "บันทึกไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  const overviewPath = `/organizations/${organizationId}/monitors`;
  const backPath = editing ? `${overviewPath}/${monitorId}` : overviewPath;
  const heading = (
    <>
      <Link
        to={backPath}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon size={14} />
        {editing ? "กลับไปมอนิเตอร์" : "กลับไปรายการมอนิเตอร์"}
      </Link>
      <PageHeader
        scope={{
          mark: organization.name,
          label: organization.name,
          tag: ROLE_LABELS[organization.role] ?? organization.role,
        }}
        title={
          initial.title === null ? "เพิ่มมอนิเตอร์" : `แก้ไข ${initial.title}`
        }
        titleRef={headingRef}
        titleTabIndex={-1}
      />
    </>
  );

  if (notFound) {
    return (
      <Page width="form">
        {heading}
        <PageState
          kind="denied"
          tone="info"
          message="ไม่พบมอนิเตอร์นี้"
          action={
            <Button asChild variant="secondary">
              <Link to={overviewPath}>กลับไปรายการมอนิเตอร์</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const advancedInUse = advancedCount(values);
  const sectionProps = {
    values,
    errors: placed,
    onChange: change,
    focusAfterRender: setFocusTarget,
    disabled: controlsOff,
  };
  return (
    <Page width="form">
      {heading}
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          void save(event);
        }}
        className="flex flex-col gap-6"
      >
        <SegmentedControl
          label="โหมด"
          value={mode}
          options={[
            { value: "basic", label: "พื้นฐาน" },
            { value: "advanced", label: "ขั้นสูง" },
          ]}
          onChange={setMode}
        />
        {mode === "basic" && advancedInUse > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <Alert tone="info" role="status">
              มีการตั้งค่าขั้นสูง {advancedInUse} รายการที่ยังใช้งานอยู่
            </Alert>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setMode("advanced");
              }}
            >
              ดูในโหมดขั้นสูง
            </Button>
          </div>
        ) : null}
        <BasicSection
          {...sectionProps}
          advanced={mode === "advanced"}
          urlNote={originBlocked ? SECRET_ORIGIN_MESSAGE : null}
        />
        {mode === "advanced" ? (
          <>
            <RequestSection {...sectionProps} />
            <SecretsSection auth={values.auth} editing={editing} />
            <AssertionsSection {...sectionProps} />
          </>
        ) : null}
        <TestPanel
          payload={
            base === null
              ? testCreatePayload(values)
              : testEditPayload(values, base)
          }
          validate={validateForTest}
          send={() =>
            base === null || monitorId === undefined
              ? testMonitorDraft(organizationId, testCreatePayload(values))
              : testMonitorEdit(
                  organizationId,
                  monitorId,
                  testEditPayload(values, base),
                )
          }
          onFormError={handleTestError}
          blockedReason={blockedReason}
          saving={saving}
          onPendingChange={setTesting}
        />
        {roleLost ? <Alert tone="error">{ROLE_CHANGED}</Alert> : null}
        {conflict ? (
          <div className="flex flex-col gap-2">
            <Alert tone="warning">{CONFLICT_MESSAGE}</Alert>
            {onReload === undefined ? null : (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void onReload();
                  }}
                >
                  โหลดค่าล่าสุด
                </Button>
              </div>
            )}
          </div>
        ) : null}
        {formError === null || roleLost ? null : (
          <Alert tone="error">{formError}</Alert>
        )}
        {unplaced.length === 0 ? null : (
          <Alert tone="error">ค่าที่กรอกไม่ถูกต้อง ตรวจสอบและลองอีกครั้ง</Alert>
        )}
        {originBlocked && !roleLost ? (
          <p className="text-sm text-foreground-secondary">
            {ORIGIN_BLOCK_NOTE}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2 border-t border-foreground/10 pt-4">
          <Button asChild variant="secondary">
            <Link to={backPath}>ยกเลิก</Link>
          </Button>
          <Button
            type="submit"
            aria-disabled={saving || testing}
            disabled={roleLost || originBlocked}
            className={saving || testing ? "opacity-60" : undefined}
          >
            {saving
              ? "กำลังบันทึก…"
              : editing
                ? "บันทึกการแก้ไข"
                : "บันทึกมอนิเตอร์"}
          </Button>
        </div>
      </form>
    </Page>
  );
}
