import {
  newCveListSchema,
  triageSchema,
  type TriageInput,
  priorityListSchema,
  vulnerabilityAdvanceSchema,
  vulnerabilityListSchema,
  vulnerabilityRunSchema,
  vulnerabilitySampleResponseSchema,
} from "@nightwatch/api-contract";

import { TENANT_QUERY_PREFIX } from "../tenant/TenantProvider";
import { ApiError, request, requestFile, type DownloadedFile } from "./client";

const base =
  "/api/organizations/{organizationId}/projects/{projectId}/vulnerabilities";
const sample = `${base}/sample` as const;

// Every key sits under TENANT_QUERY_PREFIX so switching Organization removes it (WEB-03).
export const vulnerabilityKeys = {
  all: (organizationId: string, projectId: string) =>
    [
      ...TENANT_QUERY_PREFIX,
      "vulnerabilities",
      organizationId,
      projectId,
    ] as const,
  list: (organizationId: string, projectId: string) =>
    [...vulnerabilityKeys.all(organizationId, projectId), "list"] as const,
  priority: (organizationId: string, projectId: string) =>
    [...vulnerabilityKeys.all(organizationId, projectId), "priority"] as const,
  newCves: (organizationId: string, projectId: string) =>
    [...vulnerabilityKeys.all(organizationId, projectId), "new"] as const,
  sample: (organizationId: string, projectId: string) =>
    [...vulnerabilityKeys.all(organizationId, projectId), "sample"] as const,
};

export function fetchVulnerabilities(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  return request(base, vulnerabilityListSchema, {
    params: { organizationId, projectId },
    signal,
  });
}

export function fetchNewVulnerabilities(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  return request(`${base}/new`, newCveListSchema, {
    params: { organizationId, projectId },
    signal,
  });
}

export function fetchPriority(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  return request(`${base}/priority`, priorityListSchema, {
    params: { organizationId, projectId },
    signal,
  });
}

/** One System's findings as Excel (S5.2), through the credentialed API client like every other call. */
export function downloadSystemExport(
  organizationId: string,
  projectId: string,
  systemId: string,
  signal?: AbortSignal,
): Promise<DownloadedFile> {
  return requestFile(`${base}/systems/{systemId}/export`, {
    params: { organizationId, projectId, systemId },
    signal,
  });
}

/** Sets the VEX status of one CVE of one component (S5.3); a Project admin only. */
export function putTriage(
  organizationId: string,
  projectId: string,
  input: TriageInput,
) {
  return request(`${base}/triage`, triageSchema, {
    method: "PUT",
    params: { organizationId, projectId },
    body: input,
  });
}

export function startVulnerabilityRun(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  return request(`${base}/runs`, vulnerabilityRunSchema, {
    method: "POST",
    params: { organizationId, projectId },
    signal,
  });
}

export function advanceVulnerabilityRun(
  organizationId: string,
  projectId: string,
  runId: string,
  signal?: AbortSignal,
) {
  return request(`${base}/runs/{runId}/advance`, vulnerabilityAdvanceSchema, {
    method: "POST",
    params: { organizationId, projectId, runId },
    signal,
  });
}

export function fetchSample(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  return request(sample, vulnerabilitySampleResponseSchema, {
    params: { organizationId, projectId },
    signal,
  });
}

export function drawSample(organizationId: string, projectId: string) {
  return request(sample, vulnerabilitySampleResponseSchema, {
    method: "POST",
    params: { organizationId, projectId },
  });
}

export function reviewSampleItem(
  organizationId: string,
  projectId: string,
  sampleId: string,
  position: number,
  verdict: "true_positive" | "false_positive",
) {
  return request(
    `${sample}/{sampleId}/items/{position}`,
    vulnerabilitySampleResponseSchema,
    {
      method: "PUT",
      params: {
        organizationId,
        projectId,
        sampleId,
        position,
      },
      body: { verdict },
    },
  );
}

/** The message the page shows for a failed read, run step or review. */
export function vulnerabilityErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "VULNERABILITY_SAMPLE_EMPTY") return error.message;
    if (error.code === "VULNERABILITY_TRIAGE_REASON_REQUIRED")
      return "ต้องระบุเหตุผลเมื่อเลือกไม่ได้รับผลกระทบ";
    if (error.code === "VULNERABILITY_FINDING_NOT_FOUND")
      return "ไม่พบ CVE นี้ในผลล่าสุดแล้ว โปรดโหลดหน้าใหม่";
    if (error.status === 403) return "เฉพาะผู้ดูแลโปรเจกต์ทำรายการนี้ได้";
    if (error.status === 404) return "ไม่พบข้อมูลที่ขอ หรือคุณเข้าถึงไม่ได้";
    if (error.status === 429) return "ทำรายการบ่อยเกินไป โปรดลองใหม่ภายหลัง";
    if (error.status === 503) return "บริการตรวจ CVE ยังไม่พร้อม";
  }
  return "ทำรายการไม่สำเร็จ โปรดลองใหม่";
}

export const VULNERABILITY_DENIED_MESSAGE =
  "คุณไม่มีสิทธิ์ดูช่องโหว่ของโปรเจกต์นี้";

export function isVulnerabilityAccessDenied(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "MEMBERSHIP_DENIED" || error.code === "PERMISSION_DENIED")
  );
}
