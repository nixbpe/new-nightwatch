import type {
  MeContextResponse,
  OrganizationAwsConnectionResponse,
  OrganizationAwsConnectionTestResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../../components/shell/AppShell";
import {
  disconnectOrganizationAwsConnection,
  fetchOrganizationAwsConnection,
  saveOrganizationAwsConnection,
  testOrganizationAwsConnection,
} from "../../lib/api/aws-connection";
import { ApiError } from "../../lib/api/client";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { bindQueryClientIdentity } from "../../lib/queryClient";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import { OrganizationAwsPage } from "./OrganizationAwsPage";
import { TARGET_ROLE_PLACEHOLDER } from "./policies";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333331";
const P2 = "33333333-3333-4333-8333-333333333332";
const P3 = "33333333-3333-4333-8333-333333333333";
const P4 = "33333333-3333-4333-8333-333333333334";
const ARN = "arn:aws:iam::111122223333:role/NightWatchOrgHub";
const OTHER_ARN = "arn:aws:iam::111122223333:role/Other";
const AWS_LEAF = "shell-nav-/organizations/:organizationId/aws";

vi.mock("../../lib/api/projects", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchProjectList: () => Promise.resolve({ projects: [] }),
  fetchLastProject: () => Promise.resolve({ projectId: null }),
}));
vi.mock("../../lib/api/notifications", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchUnreadCount: vi.fn(() => Promise.resolve({ unreadCount: 0 })),
}));
vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({
      data: { user: { name: "Test", email: "test@nightwatch.invalid" } },
      isPending: false,
    }),
  }),
}));
vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
}));
vi.mock("../../lib/api/aws-connection", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationAwsConnection: vi.fn(),
  testOrganizationAwsConnection: vi.fn(),
  saveOrganizationAwsConnection: vi.fn(),
  disconnectOrganizationAwsConnection: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const fetchMock = vi.mocked(fetchOrganizationAwsConnection);
const testMock = vi.mocked(testOrganizationAwsConnection);
const saveMock = vi.mocked(saveOrganizationAwsConnection);
const disconnectMock = vi.mocked(disconnectOrganizationAwsConnection);

type Role = MeContextResponse["organizations"][number]["role"];

function meContext(role: Role, extra: Role | null = null): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "นภัส วงศ์สกุล",
      email: "napat@example.com",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations: [
      { id: ORG_A, name: "Org A", slug: "org-a", role },
      ...(extra === null
        ? []
        : [{ id: ORG_B, name: "Org B", slug: "org-b", role: extra }]),
    ],
    lastActiveTenantId: ORG_A,
  };
}

function notConnected(
  overrides: Partial<OrganizationAwsConnectionResponse> = {},
): OrganizationAwsConnectionResponse {
  return {
    externalId: "nw-org-org-a-abcdefghijklmnopqrstuvwxyz",
    principalArn: "arn:aws:iam::999988887777:role/NightWatch",
    revision: 0,
    connection: null,
    projects: [],
    ...overrides,
  };
}

function connected(
  overrides: Partial<OrganizationAwsConnectionResponse> = {},
): OrganizationAwsConnectionResponse {
  return notConnected({
    revision: 3,
    connection: {
      roleArn: ARN,
      accountId: "111122223333",
      verifiedArn:
        "arn:aws:sts::111122223333:assumed-role/NightWatchOrgHub/NightWatchConnectionTest",
      testedAt: "2026-10-11T01:40:00.000Z",
      updatedAt: "2026-10-11T01:40:00.000Z",
      updatedBy: { id: "user-1", name: "สมชาย ใจดี" },
    },
    projects: [
      {
        projectId: P1,
        projectName: "Payments Platform",
        roleArn: "arn:aws:iam::444455556666:role/NightWatchReadOnly",
        accountId: "444455556666",
        lastTest: {
          result: "passed",
          code: null,
          testedAt: "2026-10-11T02:12:00.000Z",
        },
        status: "passed",
      },
      {
        projectId: P2,
        projectName: "Data Pipeline",
        roleArn: "arn:aws:iam::777788889999:role/NightWatchReadOnly",
        accountId: "777788889999",
        lastTest: {
          result: "failed",
          code: "AWS_ACCESS_DENIED",
          testedAt: "2026-10-11T02:05:00.000Z",
        },
        status: "failed",
      },
    ],
    ...overrides,
  });
}

const passed: OrganizationAwsConnectionTestResponse = {
  result: "passed",
  accountId: "111122223333",
  arn: "arn:aws:sts::111122223333:assumed-role/NightWatchOrgHub/NightWatchConnectionTest",
};

function renderPage(role: Role = "owner", extra: Role | null = null) {
  fetchMeContextMock.mockResolvedValue(meContext(role, extra));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(queryClient, "user-1");
  const router = createMemoryRouter(
    [
      {
        element: (
          <QueryClientProvider client={queryClient}>
            <TenantProvider>
              <AppShell />
            </TenantProvider>
          </QueryClientProvider>
        ),
        children: [
          {
            path: "/organizations/:organizationId/aws",
            element: <OrganizationAwsPage />,
          },
        ],
      },
    ],
    { initialEntries: [`/organizations/${ORG_A}/aws`] },
  );
  render(<RouterProvider router={router} />);
  return { router, queryClient };
}

async function typeArn(value: string) {
  const user = userEvent.setup();
  const input = await screen.findByTestId("aws-role-arn");
  await user.clear(input);
  await user.type(input, value);
  return { user, input };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("F-013 AC-08 organization menu and access", () => {
  it.each(["owner", "admin"] as const)(
    "AC-08 shows the AWS menu entry to an %s",
    async (role) => {
      fetchMock.mockResolvedValue(notConnected());
      renderPage(role);
      const nav = await screen.findByTestId("shell-navigation");
      expect(await within(nav).findByTestId(AWS_LEAF)).toHaveAttribute(
        "href",
        `/organizations/${ORG_A}/aws`,
      );
    },
  );

  it.each(["viewer", "auditor"] as const)(
    "AC-08 hides the menu entry from a %s and sends no settings request",
    async (role) => {
      renderPage(role);
      expect(await screen.findByTestId("aws-denied-message")).toHaveTextContent(
        "เฉพาะเจ้าของและผู้ดูแลองค์กรจัดการการเชื่อมต่อ AWS ได้",
      );
      expect(
        within(screen.getByTestId("shell-navigation")).queryByTestId(AWS_LEAF),
      ).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("aws-external-id")).toBeNull();
    },
  );

  it("AC-08 a server 403 latches the denied state and drops the settings", async () => {
    fetchMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    renderPage();
    expect(await screen.findByTestId("aws-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("aws-connection-card")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("R-WEB-7 AC-08 a server 403 on the first load refreshes the context and hides the menu entry", async () => {
    fetchMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    // The first context load says Owner; the refresh learns the new role.
    fetchMeContextMock
      .mockResolvedValueOnce(meContext("owner"))
      .mockResolvedValueOnce(meContext("viewer"));
    renderPage();
    expect(await screen.findByTestId("aws-denied")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(
        within(screen.getByTestId("shell-navigation")).queryByTestId(AWS_LEAF),
      ).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("R-WEB-7 AC-08 a refreshed context that still says Owner does not repeat the settings request", async () => {
    fetchMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    renderPage();
    expect(await screen.findByTestId("aws-denied")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByTestId("aws-denied")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
  });

  it("R-WEB-7 AC-08 a 403 on a refetch over loaded settings does not loop with a context that still says Owner", async () => {
    fetchMock
      .mockResolvedValueOnce(connected())
      .mockRejectedValue(new ApiError("PERMISSION_DENIED", "denied", 403));
    const { queryClient } = renderPage();
    await screen.findByTestId("aws-connection-card");
    await act(async () => {
      await queryClient
        .refetchQueries({ queryKey: ["tenant", "aws-connection", ORG_A] })
        .catch(() => undefined);
    });
    expect(await screen.findByTestId("aws-denied")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByTestId("aws-denied")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
  });
});

describe("F-013 AC-10 page states", () => {
  it("AC-10 shows loading, then the not-connected form with the External ID", async () => {
    const load = Promise.withResolvers<OrganizationAwsConnectionResponse>();
    fetchMock.mockReturnValue(load.promise);
    renderPage();
    expect(await screen.findByTestId("aws-loading")).toBeInTheDocument();
    load.resolve(notConnected());
    expect(
      await screen.findByTestId("aws-connection-status"),
    ).toHaveTextContent("ยังไม่เชื่อมต่อ");
    expect(screen.getByTestId("aws-external-id")).toHaveTextContent(
      "nw-org-org-a-abcdefghijklmnopqrstuvwxyz",
    );
    expect(screen.getByTestId("aws-connection-save")).toBeDisabled();
    expect(screen.getByTestId("aws-projects-empty")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(ORG_A);
  });

  it("AC-07 AC-10 a load failure offers a retry and never shows an empty Project list", async () => {
    fetchMock
      .mockRejectedValueOnce(new ApiError("HTTP_500", "boom", 500))
      .mockResolvedValue(connected());
    renderPage();
    expect(await screen.findByTestId("aws-load-error")).toHaveTextContent(
      "โหลดการเชื่อมต่อ AWS ไม่สำเร็จ",
    );
    expect(screen.queryByTestId("aws-projects")).toBeNull();
    expect(screen.queryByTestId("aws-projects-empty")).toBeNull();
    await userEvent.setup().click(screen.getByTestId("aws-load-retry"));
    expect(await screen.findByTestId(`aws-project-${P1}`)).toBeInTheDocument();
  });

  it("AC-10 a saved connection shows its account, role and setter", async () => {
    fetchMock.mockResolvedValue(connected());
    renderPage();
    expect(
      await screen.findByTestId("aws-connection-status"),
    ).toHaveTextContent("เชื่อมต่อแล้ว");
    expect(screen.getByTestId("aws-connection-role-arn")).toHaveTextContent(
      ARN,
    );
    expect(screen.getByTestId("aws-header-status")).toHaveTextContent(
      "บัญชีกลาง 111122223333 · ใช้อยู่ใน 2 โปรเจกต์",
    );
    expect(screen.queryByTestId("aws-connection-form")).toBeNull();
  });
});

describe("F-013 AC-02 trust policy", () => {
  it("AC-02 fills NightWatch's principal and the External ID and copies them", async () => {
    fetchMock.mockResolvedValue(notConnected());
    renderPage();
    const policy = await screen.findByTestId("aws-trust-policy");
    const parsed = JSON.parse(policy.textContent) as {
      Statement: {
        Principal: { AWS: string };
        Condition: { StringEquals: Record<string, string> };
      }[];
    };
    expect(parsed.Statement[0]?.Principal.AWS).toBe(
      "arn:aws:iam::999988887777:role/NightWatch",
    );
    expect(parsed.Statement[0]?.Condition.StringEquals["sts:ExternalId"]).toBe(
      "nw-org-org-a-abcdefghijklmnopqrstuvwxyz",
    );
    // user-event installs its own clipboard, so the copied text is read back from it.
    const user = userEvent.setup();
    await user.click(screen.getByTestId("aws-trust-policy-copy"));
    expect(await navigator.clipboard.readText()).toBe(policy.textContent);
    await user.click(
      screen.getByRole("button", { name: "คัดลอก External ID" }),
    );
    expect(await navigator.clipboard.readText()).toBe(
      "nw-org-org-a-abcdefghijklmnopqrstuvwxyz",
    );
    expect(
      await screen.findByText("คัดลอก External ID แล้ว"),
    ).toBeInTheDocument();
  });

  it("AC-02 says setup is incomplete without a principal and shows no sample policy", async () => {
    fetchMock.mockResolvedValue(notConnected({ principalArn: null }));
    renderPage();
    expect(await screen.findByTestId("aws-setup-incomplete")).toHaveTextContent(
      "ตั้งค่า NightWatch ยังไม่ครบ",
    );
    expect(screen.queryByTestId("aws-trust-policy")).toBeNull();
    expect(screen.queryByTestId("aws-trust-policy-copy")).toBeNull();
  });
});

describe("F-013 test and save form", () => {
  it("AC-05 AC-13 binds a malformed Role ARN error to the field and sends nothing", async () => {
    fetchMock.mockResolvedValue(notConnected());
    renderPage();
    const { user, input } = await typeArn("arn:aws:iam::123:role/x");
    await user.click(screen.getByTestId("aws-connection-test"));
    const error = screen.getByTestId("aws-role-arn-error");
    expect(error).toHaveTextContent("Role ARN ต้องอยู่ในรูปแบบ");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
    expect(input).toHaveAccessibleName("Role ARN ในบัญชีกลาง");
    expect(input).toHaveFocus();
    expect(testMock).not.toHaveBeenCalled();
  });

  it("AC-05 a server field error lands on the input", async () => {
    fetchMock.mockResolvedValue(notConnected());
    testMock.mockRejectedValue(
      new ApiError("AWS_ROLE_ARN_INVALID", "รูปแบบ Role ARN ไม่ถูกต้อง", 400, {
        field: "roleArn",
      }),
    );
    renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    expect(await screen.findByTestId("aws-role-arn")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("AC-03 AC-04 AC-10 AC-13 a passed test is announced as unsaved, and editing the ARN voids it", async () => {
    fetchMock.mockResolvedValue(notConnected());
    testMock.mockResolvedValue(passed);
    renderPage();
    const { user, input } = await typeArn(ARN);
    await user.keyboard("{Enter}");
    expect(testMock).toHaveBeenCalledWith(ORG_A, { roleArn: ARN, revision: 0 });
    const region = screen.getByTestId("aws-connection-result");
    expect(region).toHaveAttribute("role", "status");
    expect(
      await within(region).findByText("ทดสอบผ่าน · ยังไม่บันทึก"),
    ).toBeInTheDocument();
    expect(within(region).getByTestId("aws-test-account")).toHaveTextContent(
      "111122223333",
    );
    expect(screen.getByTestId("aws-connection-status")).toHaveTextContent(
      "ยังไม่เชื่อมต่อ",
    );
    expect(screen.getByTestId("aws-connection-save")).toBeEnabled();

    await user.type(input, "2");
    expect(screen.queryByTestId("aws-test-passed")).toBeNull();
    expect(screen.getByTestId("aws-connection-save")).toBeDisabled();
  });

  it("AC-03 a failed test shows the Thai reason and never the server text", async () => {
    fetchMock.mockResolvedValue(notConnected());
    testMock.mockResolvedValue({
      result: "failed",
      code: "AWS_ACCOUNT_MISMATCH",
    });
    renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    expect(await screen.findByTestId("aws-test-reason")).toHaveTextContent(
      "บัญชีที่ AWS ยืนยันไม่ตรงกับบัญชีใน Role ARN",
    );
    expect(screen.getByTestId("aws-connection-save")).toBeDisabled();
  });

  it("AC-11 blocks a double submit and drops a late result after the ARN changed", async () => {
    fetchMock.mockResolvedValue(notConnected());
    const first =
      Promise.withResolvers<OrganizationAwsConnectionTestResponse>();
    testMock.mockReturnValueOnce(first.promise).mockResolvedValue({
      result: "failed",
      code: "AWS_ACCESS_DENIED",
    });
    renderPage();
    const { user, input } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    await user.keyboard("{Enter}");
    expect(testMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("aws-connection-test")).toBeDisabled();

    await user.clear(input);
    await user.type(input, OTHER_ARN);
    await act(async () => {
      first.resolve(passed);
      await first.promise;
    });
    expect(screen.queryByTestId("aws-test-passed")).toBeNull();
    expect(screen.getByTestId("aws-connection-save")).toBeDisabled();

    await user.click(screen.getByTestId("aws-connection-test"));
    expect(testMock).toHaveBeenLastCalledWith(ORG_A, {
      roleArn: OTHER_ARN,
      revision: 0,
    });
    expect(await screen.findByTestId("aws-test-failed")).toBeInTheDocument();
  });

  it("AC-11 drops a late result after switching to another organization", async () => {
    fetchMock.mockImplementation((organizationId) =>
      Promise.resolve(
        notConnected({
          externalId: organizationId === ORG_A ? "nw-org-a-x" : "nw-org-b-x",
        }),
      ),
    );
    const late = Promise.withResolvers<OrganizationAwsConnectionTestResponse>();
    testMock.mockReturnValue(late.promise);
    const { router } = renderPage("owner", "owner");
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    await act(async () => {
      await router.navigate(`/organizations/${ORG_B}/aws`);
    });
    expect(await screen.findByTestId("aws-external-id")).toHaveTextContent(
      "nw-org-b-x",
    );
    await act(async () => {
      late.resolve(passed);
      await late.promise;
    });
    expect(screen.queryByTestId("aws-test-passed")).toBeNull();
    expect(screen.getByTestId("aws-role-arn")).toHaveValue("");
  });

  it("AC-11 drops a late result after the user lost Owner/Admin", async () => {
    fetchMock.mockResolvedValue(notConnected());
    const late = Promise.withResolvers<OrganizationAwsConnectionTestResponse>();
    testMock.mockReturnValue(late.promise);
    const { queryClient } = renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    fetchMeContextMock.mockResolvedValue(meContext("viewer"));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
    });
    expect(await screen.findByTestId("aws-denied")).toBeInTheDocument();
    await act(async () => {
      late.resolve(passed);
      await late.promise;
    });
    expect(screen.queryByTestId("aws-test-passed")).toBeNull();
    expect(screen.getByTestId("aws-denied")).toBeInTheDocument();
  });

  it("AC-11 a 403 during a test drops the result and shows the denied state", async () => {
    fetchMock
      .mockResolvedValueOnce(notConnected())
      .mockRejectedValue(new ApiError("PERMISSION_DENIED", "denied", 403));
    testMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    expect(await screen.findByTestId("aws-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("aws-external-id")).toBeNull();
  });

  it("AC-04 AC-10 saves the tested value with the loaded revision and shows it saved", async () => {
    fetchMock.mockResolvedValue(notConnected());
    testMock.mockResolvedValue(passed);
    saveMock.mockResolvedValue(connected({ revision: 1, projects: [] }));
    renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    await user.click(await screen.findByTestId("aws-connection-save"));
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith(ORG_A, { roleArn: ARN, revision: 0 });
    expect(await screen.findByTestId("aws-connection-saved")).toHaveTextContent(
      "บันทึกการเชื่อมต่อแล้ว",
    );
    expect(screen.getByTestId("aws-connection-status")).toHaveTextContent(
      "เชื่อมต่อแล้ว",
    );
    expect(screen.queryByTestId("aws-connection-form")).toBeNull();
  });

  it("moves focus into the Role ARN field on Edit and to the card heading on cancel", async () => {
    fetchMock.mockResolvedValue(connected());
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("aws-connection-edit"));
    expect(screen.getByTestId("aws-role-arn")).toHaveFocus();
    await user.click(screen.getByTestId("aws-connection-cancel-edit"));
    expect(
      screen.getByRole("heading", { name: "บัญชี AWS กลางขององค์กร" }),
    ).toHaveFocus();
  });

  it("AC-04 a failed server re-test keeps the saved value and the input", async () => {
    fetchMock.mockResolvedValue(connected());
    testMock.mockResolvedValue(passed);
    saveMock.mockRejectedValue(
      new ApiError("AWS_CONNECTION_TEST_FAILED", "raw", 422, {
        code: "AWS_ACCESS_DENIED",
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("aws-connection-edit"));
    const { input } = await typeArn(OTHER_ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    await user.click(await screen.findByTestId("aws-connection-save"));
    expect(await screen.findByTestId("aws-test-reason")).toHaveTextContent(
      "AWS ปฏิเสธการ assume role",
    );
    expect(screen.queryByText("raw")).toBeNull();
    expect(input).toHaveValue(OTHER_ARN);
    expect(screen.getByTestId("aws-connection-role-arn")).toHaveTextContent(
      ARN,
    );
    expect(screen.getByTestId("aws-connection-save")).toBeDisabled();
  });

  it("AC-11 a revision conflict shows a reload notice without overwriting", async () => {
    fetchMock
      .mockResolvedValueOnce(notConnected())
      .mockResolvedValue(connected({ revision: 4 }));
    testMock.mockRejectedValue(
      new ApiError("AWS_CONNECTION_REVISION_CONFLICT", "conflict", 409, {
        currentRevision: 4,
      }),
    );
    renderPage();
    const { user, input } = await typeArn(OTHER_ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    expect(
      await screen.findByTestId("aws-connection-conflict"),
    ).toHaveTextContent("ถูกแก้ไขจากคำขออื่น");
    expect(input).toHaveValue(OTHER_ARN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("aws-connection-reload"));
    expect(
      await screen.findByTestId("aws-connection-role-arn"),
    ).toHaveTextContent(ARN);
  });

  it.each([
    [
      "AC-12 a rate limit names the wait and offers a retry",
      new ApiError("AWS_TEST_RATE_LIMITED", "raw", 429, {
        retryAfterSeconds: 42,
      }),
      "ลองใหม่ได้ในอีก 42 วินาที",
    ],
    [
      "AC-12 an unavailable limiter says the service is not ready",
      new ApiError("RATE_LIMIT_UNAVAILABLE", "raw", 503),
      "บริการทดสอบการเชื่อมต่อไม่พร้อมใช้งานชั่วคราว",
    ],
  ])("%s", async (_name, error, message) => {
    fetchMock.mockResolvedValue(notConnected());
    testMock.mockRejectedValueOnce(error).mockResolvedValue(passed);
    renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    expect(
      await screen.findByTestId("aws-connection-request-error"),
    ).toHaveTextContent(message);
    expect(screen.queryByTestId("aws-test-passed")).toBeNull();
    expect(screen.getByTestId("aws-connection-save")).toBeDisabled();
    expect(screen.getByTestId("aws-connection-status")).toHaveTextContent(
      "ยังไม่เชื่อมต่อ",
    );
    await user.click(screen.getByTestId("aws-connection-retry"));
    expect(await screen.findByTestId("aws-test-passed")).toBeInTheDocument();
    expect(testMock).toHaveBeenCalledTimes(2);
  });
});

describe("F-013 AC-06 disconnect", () => {
  it("AC-06 AC-13 states the affected count; cancel changes nothing and returns focus", async () => {
    fetchMock.mockResolvedValue(connected());
    renderPage();
    const user = userEvent.setup();
    const opener = await screen.findByTestId("aws-connection-disconnect");
    await user.click(opener);
    const dialog = screen.getByTestId("aws-disconnect-dialog");
    expect(
      within(dialog).getByTestId("aws-disconnect-impact"),
    ).toHaveTextContent("โปรเจกต์ที่ใช้บัญชีกลาง 2 โปรเจกต์");
    expect(within(dialog).getByTestId("confirmation-cancel")).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByTestId("aws-disconnect-confirm")).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByTestId("confirmation-cancel")).toHaveFocus();
    await user.click(within(dialog).getByTestId("confirmation-cancel"));
    expect(screen.queryByTestId("aws-disconnect-dialog")).toBeNull();
    expect(opener).toHaveFocus();
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("aws-connection-status")).toHaveTextContent(
      "เชื่อมต่อแล้ว",
    );
  });

  it("AC-01 AC-06 confirm sends the revision and keeps the External ID", async () => {
    fetchMock.mockResolvedValue(connected());
    disconnectMock.mockResolvedValue(
      notConnected({
        revision: 4,
        projects: connected().projects.map((project) => ({
          ...project,
          status: "stale" as const,
        })),
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("aws-connection-disconnect"));
    await user.click(screen.getByTestId("aws-disconnect-confirm"));
    expect(disconnectMock).toHaveBeenCalledWith(ORG_A, 3);
    expect(
      await screen.findByTestId("aws-connection-disconnected"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("aws-external-id")).toHaveTextContent(
      "nw-org-org-a-abcdefghijklmnopqrstuvwxyz",
    );
    expect(
      within(screen.getByTestId(`aws-project-${P1}`)).getByTestId(
        "aws-project-status",
      ),
    ).toHaveTextContent("ผลเก่า");
    expect(
      within(screen.getByTestId(`aws-project-${P1}`)).getByTestId(
        "aws-project-status",
      ),
    ).toHaveTextContent("ต้องตั้งค่าบัญชีกลางแล้วทดสอบใหม่");
  });

  it("AC-11 a conflicting disconnect closes the dialog with a reload notice", async () => {
    fetchMock.mockResolvedValue(connected());
    disconnectMock.mockRejectedValue(
      new ApiError("AWS_CONNECTION_REVISION_CONFLICT", "conflict", 409, {
        currentRevision: 5,
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("aws-connection-disconnect"));
    await user.click(screen.getByTestId("aws-disconnect-confirm"));
    expect(
      await screen.findByTestId("aws-connection-conflict"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId("aws-disconnect-dialog")).toBeNull();
    });
  });
});

describe("F-013 AC-07 Project table", () => {
  it("AC-07 AC-13 writes each status as text", async () => {
    const base = connected().projects;
    fetchMock.mockResolvedValue(
      connected({
        projects: [
          ...base,
          {
            projectId: P3,
            projectName: "Internal Tools",
            roleArn: "arn:aws:iam::123412341234:role/ReadOnly",
            accountId: "123412341234",
            lastTest: null,
            status: "untested",
          },
          {
            projectId: P4,
            projectName: "Legacy",
            roleArn: "arn:aws:iam::432143214321:role/ReadOnly",
            accountId: "432143214321",
            lastTest: {
              result: "passed",
              code: null,
              testedAt: "2026-09-01T00:00:00.000Z",
            },
            status: "stale",
          },
        ],
      }),
    );
    renderPage();
    const status = async (id: string) =>
      within(await screen.findByTestId(`aws-project-${id}`)).getByTestId(
        "aws-project-status",
      );
    expect(await status(P1)).toHaveTextContent("ผ่าน");
    expect(await status(P2)).toHaveTextContent("ไม่ผ่าน");
    expect(await status(P2)).toHaveTextContent("AWS ปฏิเสธการ assume role");
    expect(await status(P3)).toHaveTextContent("ยังไม่ทดสอบ");
    expect(await status(P4)).toHaveTextContent("ผลเก่า");
    expect(await status(P4)).toHaveTextContent(
      "ต้องทดสอบใหม่กับบัญชีกลางปัจจุบัน",
    );
    expect(
      within(screen.getByTestId(`aws-project-${P1}`)).getByRole("link", {
        name: "Payments Platform",
      }),
    ).toHaveAttribute(
      "href",
      `/organizations/${ORG_A}/projects/${P1}/overview`,
    );
  });
});

describe("F-013 repair round 1", () => {
  it("R-WEB-1 AC-04 editing the ARN after a failed save drops the error and its retry", async () => {
    fetchMock.mockResolvedValue(notConnected());
    testMock.mockResolvedValue(passed);
    saveMock.mockRejectedValue(
      new ApiError("AWS_TEST_RATE_LIMITED", "raw", 429, {
        retryAfterSeconds: 30,
      }),
    );
    renderPage();
    const { user, input } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    await user.click(await screen.findByTestId("aws-connection-save"));
    expect(
      await screen.findByTestId("aws-connection-request-error"),
    ).toHaveTextContent("30 วินาที");
    await user.type(input, "2");
    expect(screen.queryByTestId("aws-connection-request-error")).toBeNull();
    expect(screen.queryByTestId("aws-connection-retry")).toBeNull();
    expect(screen.getByTestId("aws-connection-save")).toBeDisabled();
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("R-WEB-2 AC-11 a reload after 409 keeps the draft when the account got connected elsewhere", async () => {
    fetchMock
      .mockResolvedValueOnce(notConnected())
      .mockResolvedValue(connected({ revision: 4 }));
    testMock.mockRejectedValue(
      new ApiError("AWS_CONNECTION_REVISION_CONFLICT", "conflict", 409, {
        currentRevision: 4,
      }),
    );
    renderPage();
    const { user } = await typeArn(OTHER_ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    await user.click(await screen.findByTestId("aws-connection-reload"));
    expect(
      await screen.findByTestId("aws-connection-role-arn"),
    ).toHaveTextContent(ARN);
    expect(screen.getByTestId("aws-role-arn")).toHaveValue(OTHER_ARN);
    expect(screen.getByTestId("aws-connection-save")).toBeDisabled();
  });

  it("R-WEB-2 a background refetch keeps the draft and its test result", async () => {
    fetchMock
      .mockResolvedValueOnce(notConnected())
      .mockResolvedValue(connected({ revision: 1 }));
    testMock.mockResolvedValue(passed);
    const { queryClient } = renderPage();
    const { user } = await typeArn(OTHER_ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    expect(await screen.findByTestId("aws-test-passed")).toBeInTheDocument();
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["tenant", "aws-connection", ORG_A],
      });
    });
    expect(
      await screen.findByTestId("aws-connection-role-arn"),
    ).toHaveTextContent(ARN);
    expect(screen.getByTestId("aws-role-arn")).toHaveValue(OTHER_ARN);
    expect(screen.getByTestId("aws-test-passed")).toHaveTextContent(
      "ผลนี้ทดสอบกับข้อมูลก่อนโหลดใหม่",
    );
    // The stale result already carries the change; no second notice.
    expect(screen.queryByTestId("aws-connection-changed")).toBeNull();
    expect(screen.getByTestId("aws-connection-save")).toBeDisabled();
  });

  it.each(["new draft", "edit"] as const)(
    "R-WEB-11 AC-11 another request changing the connection under an untested %s shows a notice",
    async (kind) => {
      const changed = connected({ revision: kind === "edit" ? 4 : 1 });
      if (changed.connection !== null) {
        changed.connection.roleArn = OTHER_ARN;
        changed.connection.updatedBy = { id: "user-2", name: "วิภา ศรีสุข" };
      }
      fetchMock
        .mockResolvedValueOnce(kind === "edit" ? connected() : notConnected())
        .mockResolvedValue(changed);
      testMock.mockResolvedValue(passed);
      const { queryClient } = renderPage();
      const user = userEvent.setup();
      if (kind === "edit") {
        await user.click(await screen.findByTestId("aws-connection-edit"));
      } else {
        await typeArn(ARN);
      }
      expect(screen.queryByTestId("aws-connection-changed")).toBeNull();
      await act(async () => {
        await queryClient.invalidateQueries({
          queryKey: ["tenant", "aws-connection", ORG_A],
        });
      });
      expect(
        await screen.findByTestId("aws-connection-changed"),
      ).toHaveTextContent("การเชื่อมต่อ AWS เพิ่งถูกแก้ไขจากคำขออื่น");
      expect(screen.getByTestId("aws-connection-role-arn")).toHaveTextContent(
        OTHER_ARN,
      );
      expect(screen.getByTestId("aws-role-arn")).toHaveValue(ARN);
      // Testing against the latest data acknowledges the change.
      await user.click(screen.getByTestId("aws-connection-test"));
      expect(await screen.findByTestId("aws-test-passed")).toBeInTheDocument();
      expect(screen.queryByTestId("aws-connection-changed")).toBeNull();
      expect(screen.getByTestId("aws-connection-save")).toBeEnabled();
    },
  );

  it("R-WEB-11 AC-11 a failed test result does not hide the change notice", async () => {
    fetchMock
      .mockResolvedValueOnce(notConnected())
      .mockResolvedValue(connected({ revision: 1 }));
    testMock.mockResolvedValue({ result: "failed", code: "AWS_ACCESS_DENIED" });
    const { queryClient } = renderPage();
    const { user } = await typeArn(OTHER_ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    expect(await screen.findByTestId("aws-test-failed")).toBeInTheDocument();
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["tenant", "aws-connection", ORG_A],
      });
    });
    expect(
      await screen.findByTestId("aws-connection-changed"),
    ).toBeInTheDocument();
    // A failed test against the latest data still acknowledges the change.
    await user.click(screen.getByTestId("aws-connection-test"));
    await waitFor(() => {
      expect(testMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("aws-connection-changed")).toBeNull();
    });
    expect(screen.getByTestId("aws-test-failed")).toBeInTheDocument();
  });

  it("R-WEB-3 a failed refetch keeps the card and offers an inline retry", async () => {
    fetchMock
      .mockResolvedValueOnce(notConnected())
      .mockRejectedValueOnce(new ApiError("HTTP_500", "boom", 500))
      .mockResolvedValue(notConnected());
    const { queryClient } = renderPage();
    await typeArn(ARN);
    await act(async () => {
      await queryClient
        .refetchQueries({ queryKey: ["tenant", "aws-connection", ORG_A] })
        .catch(() => undefined);
    });
    expect(await screen.findByTestId("aws-refresh-error")).toHaveTextContent(
      "โหลดข้อมูลล่าสุดไม่สำเร็จ",
    );
    expect(screen.queryByTestId("aws-load-error")).toBeNull();
    expect(screen.getByTestId("aws-role-arn")).toHaveValue(ARN);
    await userEvent.setup().click(screen.getByTestId("aws-refresh-retry"));
    await waitFor(() => {
      expect(screen.queryByTestId("aws-refresh-error")).toBeNull();
    });
  });

  it("R-WEB-4 AC-13 focus moves to the card heading after a confirmed disconnect", async () => {
    fetchMock.mockResolvedValue(connected());
    disconnectMock.mockResolvedValue(notConnected({ revision: 4 }));
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("aws-connection-disconnect"));
    await user.click(screen.getByTestId("aws-disconnect-confirm"));
    await screen.findByTestId("aws-connection-disconnected");
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "บัญชี AWS กลางขององค์กร" }),
      ).toHaveFocus();
    });
  });

  it("R-WEB-5 announces every copy and a failed copy", async () => {
    fetchMock.mockResolvedValue(notConnected());
    renderPage();
    const user = userEvent.setup();
    const button = await screen.findByTestId("aws-external-id-copy");
    const status = screen.getByTestId("aws-external-id-copy-status");
    await user.click(button);
    await waitFor(() => {
      expect(status).toHaveTextContent("คัดลอก External ID แล้ว");
    });
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const second = Promise.withResolvers<undefined>();
    writeText.mockReturnValueOnce(second.promise);
    await user.click(button);
    expect(status).toHaveTextContent("");
    await act(async () => {
      second.resolve(undefined);
      await second.promise;
    });
    expect(status).toHaveTextContent("คัดลอก External ID แล้ว");
    writeText.mockRejectedValueOnce(new Error("denied"));
    await user.click(button);
    await waitFor(() => {
      expect(status).toHaveTextContent("คัดลอกไม่สำเร็จ");
    });
  });

  it("E-3 AC-11 a 409 on save keeps the input and shows the reload notice", async () => {
    fetchMock.mockResolvedValue(notConnected());
    testMock.mockResolvedValue(passed);
    saveMock.mockRejectedValue(
      new ApiError("AWS_CONNECTION_REVISION_CONFLICT", "conflict", 409, {
        currentRevision: 1,
      }),
    );
    renderPage();
    const { user, input } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    await user.click(await screen.findByTestId("aws-connection-save"));
    expect(
      await screen.findByTestId("aws-connection-conflict"),
    ).toBeInTheDocument();
    expect(input).toHaveValue(ARN);
    expect(screen.getByTestId("aws-connection-status")).toHaveTextContent(
      "ยังไม่เชื่อมต่อ",
    );
  });

  it("E-3 AC-11 a double click on save sends one request", async () => {
    fetchMock.mockResolvedValue(notConnected());
    testMock.mockResolvedValue(passed);
    const saving = Promise.withResolvers<OrganizationAwsConnectionResponse>();
    saveMock.mockReturnValue(saving.promise);
    renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    const save = await screen.findByTestId("aws-connection-save");
    await waitFor(() => {
      expect(save).toBeEnabled();
    });
    await user.dblClick(save);
    expect(saveMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      saving.resolve(connected({ revision: 1 }));
      await saving.promise;
    });
    expect(
      await screen.findByTestId("aws-connection-saved"),
    ).toBeInTheDocument();
  });

  it.each(["save", "disconnect"] as const)(
    "E-3 AC-08 a 403 on %s shows the denied state",
    async (kind) => {
      const denied = new ApiError("PERMISSION_DENIED", "denied", 403);
      fetchMock
        .mockResolvedValueOnce(kind === "save" ? notConnected() : connected())
        .mockRejectedValue(denied);
      testMock.mockResolvedValue(passed);
      saveMock.mockRejectedValue(denied);
      disconnectMock.mockRejectedValue(denied);
      renderPage();
      const user = userEvent.setup();
      if (kind === "save") {
        await typeArn(ARN);
        await user.click(screen.getByTestId("aws-connection-test"));
        await user.click(await screen.findByTestId("aws-connection-save"));
      } else {
        await user.click(
          await screen.findByTestId("aws-connection-disconnect"),
        );
        await user.click(screen.getByTestId("aws-disconnect-confirm"));
      }
      expect(await screen.findByTestId("aws-denied")).toBeInTheDocument();
      expect(screen.queryByTestId("aws-external-id")).toBeNull();
    },
  );

  it.each(["save", "disconnect"] as const)(
    "PR-119 AC-11 a GET in flight during %s cannot restore the old snapshot",
    async (kind) => {
      const before = kind === "save" ? notConnected() : connected();
      const stale = Promise.withResolvers<OrganizationAwsConnectionResponse>();
      fetchMock
        .mockResolvedValueOnce(before)
        .mockReturnValueOnce(stale.promise);
      testMock.mockResolvedValue(passed);
      saveMock.mockResolvedValue(connected({ revision: 1 }));
      disconnectMock.mockResolvedValue(notConnected({ revision: 4 }));
      const { queryClient } = renderPage();
      const user = userEvent.setup();
      if (kind === "save") {
        await typeArn(ARN);
        await user.click(screen.getByTestId("aws-connection-test"));
      } else {
        await screen.findByTestId("aws-connection-disconnect");
      }
      // A background refetch starts and stays pending.
      void queryClient.invalidateQueries({
        queryKey: ["tenant", "aws-connection", ORG_A],
      });
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
      if (kind === "save") {
        await user.click(await screen.findByTestId("aws-connection-save"));
        await screen.findByTestId("aws-connection-saved");
      } else {
        await user.click(screen.getByTestId("aws-connection-disconnect"));
        await user.click(screen.getByTestId("aws-disconnect-confirm"));
        await screen.findByTestId("aws-connection-disconnected");
      }
      await act(async () => {
        stale.resolve(before);
        await stale.promise;
      });
      expect(screen.getByTestId("aws-connection-status")).toHaveTextContent(
        kind === "save" ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ",
      );
      expect(
        queryClient.getQueryData<OrganizationAwsConnectionResponse>([
          "tenant",
          "aws-connection",
          ORG_A,
        ])?.revision,
      ).toBe(kind === "save" ? 1 : 4);
    },
  );
});

describe("ORG-03 ORG-05 ORG-06 ORG-16 setup steps and guidance", () => {
  it("ORG-03 lists the steps before the connection card until the account is connected", async () => {
    fetchMock.mockResolvedValue(notConnected());
    renderPage();
    const steps = await screen.findByTestId("aws-setup-steps");
    const card = screen.getByTestId("aws-connection-card");
    expect(steps).toHaveAttribute("open");
    expect(
      steps.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    // Step 1 owns the External ID before a connection; the card does not repeat it.
    expect(within(steps).getByTestId("aws-external-id")).toBeInTheDocument();
    expect(screen.getAllByTestId("aws-external-id")).toHaveLength(1);
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
  });

  it("ORG-03 folds the steps after the card once connected and keeps the External ID in the card", async () => {
    fetchMock.mockResolvedValue(connected());
    renderPage();
    const steps = await screen.findByTestId("aws-setup-steps");
    const card = screen.getByTestId("aws-connection-card");
    expect(steps).not.toHaveAttribute("open");
    expect(
      card.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(within(card).getByTestId("aws-external-id")).toBeInTheDocument();
    expect(screen.getAllByTestId("aws-external-id")).toHaveLength(1);
  });

  it("ORG-06 offers a permission policy that names only the Projects' role ARNs, with no wildcard", async () => {
    fetchMock.mockResolvedValue(connected());
    renderPage();
    const policy = await screen.findByTestId("aws-permission-policy");
    const parsed = JSON.parse(policy.textContent) as {
      Statement: { Action: string; Effect: string; Resource: string[] }[];
    };
    expect(parsed.Statement).toHaveLength(1);
    expect(parsed.Statement[0]?.Action).toBe("sts:AssumeRole");
    expect(parsed.Statement[0]?.Resource).toEqual([
      "arn:aws:iam::444455556666:role/NightWatchReadOnly",
      "arn:aws:iam::777788889999:role/NightWatchReadOnly",
    ]);
    expect(policy.textContent).not.toContain("*");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("aws-permission-policy-copy"));
    expect(await navigator.clipboard.readText()).toBe(policy.textContent);
  });

  it("ORG-06 shows a placeholder Resource, not a wildcard, while no Project uses the account", async () => {
    fetchMock.mockResolvedValue(notConnected());
    renderPage();
    const policy = await screen.findByTestId("aws-permission-policy");
    expect(policy.textContent).toContain(TARGET_ROLE_PLACEHOLDER);
    expect(policy.textContent).not.toContain("*");
  });

  it("ORG-05 lists the three checks with copy buttons after an access-denied test, and not after a timeout", async () => {
    fetchMock.mockResolvedValue(notConnected());
    testMock.mockResolvedValueOnce({
      result: "failed",
      code: "AWS_ACCESS_DENIED",
    });
    renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    const checklist = await screen.findByTestId("aws-test-checklist");
    expect(within(checklist).getAllByRole("listitem")).toHaveLength(3);
    await user.click(screen.getByTestId("aws-checklist-external-id-copy"));
    expect(await navigator.clipboard.readText()).toBe(
      "nw-org-org-a-abcdefghijklmnopqrstuvwxyz",
    );
    await user.click(screen.getByTestId("aws-checklist-trust-copy"));
    expect(await navigator.clipboard.readText()).toBe(
      screen.getByTestId("aws-trust-policy").textContent,
    );
    testMock.mockResolvedValueOnce({ result: "failed", code: "AWS_TIMEOUT" });
    await user.type(screen.getByTestId("aws-role-arn"), "x");
    await user.click(screen.getByTestId("aws-connection-test"));
    await screen.findByTestId("aws-test-reason");
    expect(screen.queryByTestId("aws-test-checklist")).toBeNull();
  });

  it("ORG-05 the checklist link opens the folded steps", async () => {
    fetchMock.mockResolvedValue(connected());
    testMock.mockResolvedValue({
      result: "failed",
      code: "AWS_ACCESS_DENIED",
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("aws-connection-retest"));
    const steps = screen.getByTestId("aws-setup-steps");
    expect(steps).not.toHaveAttribute("open");
    await user.click(await screen.findByTestId("aws-checklist-steps-link"));
    expect(steps).toHaveAttribute("open");
  });

  it("ORG-16 points to the Project list after saving and from the empty Project table", async () => {
    fetchMock.mockResolvedValue(notConnected());
    testMock.mockResolvedValue(passed);
    saveMock.mockResolvedValue(connected({ revision: 1, projects: [] }));
    renderPage();
    expect(
      await screen.findByTestId("aws-projects-empty-link"),
    ).toHaveAttribute("href", `/organizations/${ORG_A}/projects`);
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-connection-test"));
    await user.click(await screen.findByTestId("aws-connection-save"));
    expect(
      await screen.findByTestId("aws-connection-saved-link"),
    ).toHaveAttribute("href", `/organizations/${ORG_A}/projects`);
  });
});
