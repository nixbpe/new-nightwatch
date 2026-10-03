import {
  AUDIT_ACTION_LABELS as CONTRACT_LABELS,
  AUDIT_ACTIONS as CONTRACT_ACTIONS,
  AUDIT_EXPORT_FILE_TTL_HOURS as CONTRACT_TTL,
  AUDIT_EXPORT_MAX_BYTES as CONTRACT_MAX_BYTES,
  AUDIT_EXPORT_MAX_EVENTS as CONTRACT_MAX_EVENTS,
  AUDIT_EXPORT_FAILURE_CODES,
  auditScopeNote as contractScopeNote,
  type AuditChange as ContractChange,
  type AuditExportFailureCode as ContractFailureCode,
} from "@nightwatch/api-contract";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_EXPORT_FILE_TTL_HOURS,
  AUDIT_EXPORT_MAX_BYTES,
  AUDIT_EXPORT_MAX_EVENTS,
  auditActionCodesMatching,
  auditScopeNote,
  type AuditChange,
  type AuditExportFailureCode,
} from "@nightwatch/shared";
import { describe, expect, it } from "vitest";

// The Worker reads these from @nightwatch/shared (PKG-01); the API and the web
// read the contract's. Both copies must say the same thing.
describe("shared copies equal the contract", () => {
  it("lists the same actions with the same labels", () => {
    expect([...AUDIT_ACTIONS]).toEqual([...CONTRACT_ACTIONS]);
    expect(AUDIT_ACTION_LABELS).toEqual(CONTRACT_LABELS);
  });

  it("has the same export limits and failure codes", () => {
    expect([
      AUDIT_EXPORT_MAX_EVENTS,
      AUDIT_EXPORT_MAX_BYTES,
      AUDIT_EXPORT_FILE_TTL_HOURS,
    ]).toEqual([CONTRACT_MAX_EVENTS, CONTRACT_MAX_BYTES, CONTRACT_TTL]);
    const failureCodes: AuditExportFailureCode[] = [
      ...AUDIT_EXPORT_FAILURE_CODES,
    ];
    const contractCodes: ContractFailureCode[] = failureCodes;
    expect(contractCodes).toEqual([...AUDIT_EXPORT_FAILURE_CODES]);
  });

  it("writes the same scope note", () => {
    for (const date of ["2026-10-03", "2025-01-01"]) {
      expect(auditScopeNote(date)).toBe(contractScopeNote(date));
    }
  });

  it("accepts a change of either package in the other (type check)", () => {
    const fromContract: ContractChange = {
      field: "secret",
      key: "auth.token",
      before: null,
      after: { kind: "secret_set" },
    };
    const asShared: AuditChange = fromContract;
    const backAgain: ContractChange = asShared;
    expect(backAgain).toEqual(fromContract);
  });

  it("finds action codes by code or label, in any case", () => {
    expect(auditActionCodesMatching("MEMBER.REVOKE")).toEqual([
      "organization.member.revoke",
    ]);
    expect(auditActionCodesMatching("ถอนสมาชิก")).toEqual([
      "organization.member.revoke",
    ]);
    expect(auditActionCodesMatching("no such action")).toEqual([]);
  });
});
