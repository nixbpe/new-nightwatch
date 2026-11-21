import type {
  AwsOrganization,
  MeContextResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../../components/shell/AppShell";
import {
  awsKeys,
  checkOrganizationAws,
  disconnectOrganizationAws,
  fetchOrganizationAws,
} from "../../lib/api/aws";
import { ApiError } from "../../lib/api/client";
import { fetchMeContext } from "../../lib/api/me";
import { bindQueryClientIdentity } from "../../lib/queryClient";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import { OrganizationAwsPage } from "./OrganizationAwsPage";

const ORG = "11111111-1111-4111-8111-111111111111";
const REV_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const REV_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ARN = "arn:aws:iam::111122223333:role/NightWatchOrgHub";
const OTHER_ARN = "arn:aws:iam::111122223333:role/Other";
const AWS_LEAF = "shell-nav-/organizations/:organizationId/aws";
const KEY = awsKeys.organization(ORG);

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
vi.mock("../../lib/api/aws", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationAws: vi.fn(),
  checkOrganizationAws: vi.fn(),
  disconnectOrganizationAws: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const fetchMock = vi.mocked(fetchOrganizationAws);
const checkMock = vi.mocked(checkOrganizationAws);
const disconnectMock = vi.mocked(disconnectOrganizationAws);

type Role = MeContextResponse["organizations"][number]["role"];

function meContext(role: Role): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "Owner",
      email: "owner@nightwatch.invalid",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations: [{ id: ORG, name: "Org", slug: "org", role }],
    lastActiveTenantId: ORG,
  };
}

function hub(overrides: Partial<AwsOrganization> = {}): AwsOrganization {
  return {
    revision: REV_1,
    roleArn: null,
    accountId: null,
    lastTestAt: null,
    externalId: "nw-org-org-abcdefghijklmnopqrstuvwxyz",
    trustPolicy: '{"Version":"2012-10-17"}',
    projects: [],
    ...overrides,
  };
}

const passed = {
  ok: true as const,
  accountId: "111122223333",
  arn: "arn:aws:sts::111122223333:assumed-role/NightWatchOrgHub/Test",
};
const denied = () => new ApiError("PERMISSION_DENIED", "denied", 403);

function renderPage() {
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
    { initialEntries: [`/organizations/${ORG}/aws`] },
  );
  render(<RouterProvider router={router} />);
  return { queryClient };
}

async function typeArn(value: string) {
  const user = userEvent.setup();
  const input = await screen.findByTestId("aws-role-arn");
  await user.clear(input);
  await user.type(input, value);
  return { user, input };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

afterEach(() => {
  vi.resetAllMocks();
});

describe("F-013 AC-08 a server denial refreshes the context", () => {
  it("D5 a 403 on the first load refreshes the context and hides the menu entry", async () => {
    fetchMeContextMock
      .mockResolvedValueOnce(meContext("owner"))
      .mockResolvedValue(meContext("viewer"));
    fetchMock.mockRejectedValue(denied());
    renderPage();
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(
        within(screen.getByTestId("shell-navigation")).queryByTestId(AWS_LEAF),
      ).toBeNull();
    });
    expect(
      await screen.findByText("คุณเข้าถึงการเชื่อมต่อนี้ไม่ได้"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("D5 a context that still says Owner does not repeat the settings request", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock.mockRejectedValue(denied());
    renderPage();
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
  });

  it("D5 a 403 on a refetch over loaded settings shows the denial without looping", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock.mockResolvedValueOnce(hub()).mockRejectedValue(denied());
    const { queryClient } = renderPage();
    await screen.findByTestId("aws-role-arn");
    await act(async () => {
      await queryClient
        .refetchQueries({ queryKey: KEY })
        .catch(() => undefined);
    });
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    await settle();
    expect(
      screen.getByText("คุณเข้าถึงการเชื่อมต่อนี้ไม่ได้", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("aws-role-arn")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
  });

  it("D5 a 403 on save refreshes the context", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock.mockResolvedValue(hub());
    checkMock.mockResolvedValueOnce(passed).mockRejectedValue(denied());
    renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-test"));
    await user.click(await screen.findByTestId("aws-save"));
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe("F-013 AC-07 AC-11 refetches keep the form", () => {
  it("D3c a failed refetch keeps the draft and offers an inline retry", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock
      .mockResolvedValueOnce(hub())
      .mockRejectedValueOnce(new ApiError("HTTP_500", "boom", 500))
      .mockResolvedValue(hub());
    const { queryClient } = renderPage();
    await typeArn(ARN);
    await act(async () => {
      await queryClient
        .refetchQueries({ queryKey: KEY })
        .catch(() => undefined);
    });
    expect(await screen.findByTestId("aws-refresh-error")).toHaveTextContent(
      "โหลดข้อมูลล่าสุดไม่สำเร็จ",
    );
    expect(screen.getByTestId("aws-role-arn")).toHaveValue(ARN);
    await userEvent
      .setup()
      .click(
        within(screen.getByTestId("aws-refresh-error")).getByRole("button"),
      );
    await waitFor(() => {
      expect(screen.queryByTestId("aws-refresh-error")).toBeNull();
    });
    expect(screen.getByTestId("aws-role-arn")).toHaveValue(ARN);
  });

  it("D6 another request's change under a tested draft is announced and blocks Save until a new test", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock
      .mockResolvedValueOnce(hub())
      .mockResolvedValue(hub({ revision: REV_2, roleArn: OTHER_ARN }));
    checkMock.mockResolvedValue(passed);
    const { queryClient } = renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-test"));
    await screen.findByTestId("aws-test-passed");
    expect(screen.getByTestId("aws-save")).toBeEnabled();
    expect(screen.getByTestId("aws-connection-changed")).toBeEmptyDOMElement();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
    });
    expect(
      await screen.findByText("การตั้งค่าถูกแก้ไขจากคำขออื่น", {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("aws-role-arn")).toHaveValue(ARN);
    expect(screen.getByTestId("aws-save")).toBeDisabled();
    await user.click(screen.getByTestId("aws-test"));
    await waitFor(() => {
      expect(screen.getByTestId("aws-save")).toBeEnabled();
    });
    expect(screen.getByTestId("aws-connection-changed")).toBeEmptyDOMElement();
    expect(checkMock.mock.lastCall?.slice(0, 4)).toEqual([
      ORG,
      ARN,
      REV_2,
      false,
    ]);
  });

  it("D6 a change while nothing is typed takes the new value without a notice", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock
      .mockResolvedValueOnce(hub({ roleArn: ARN, accountId: "111122223333" }))
      .mockResolvedValue(
        hub({ revision: REV_2, roleArn: OTHER_ARN, accountId: "111122223333" }),
      );
    const { queryClient } = renderPage();
    expect(await screen.findByTestId("aws-role-arn")).toHaveValue(ARN);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
    });
    await waitFor(() => {
      expect(screen.getByTestId("aws-role-arn")).toHaveValue(OTHER_ARN);
    });
    expect(screen.getByTestId("aws-connection-changed")).toBeEmptyDOMElement();
  });

  it("D6 our own save does not announce a change from another request", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock
      .mockResolvedValueOnce(hub())
      .mockResolvedValue(
        hub({ revision: REV_2, roleArn: ARN, accountId: "111122223333" }),
      );
    checkMock.mockResolvedValue(passed);
    renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-test"));
    await user.click(await screen.findByTestId("aws-save"));
    expect(await screen.findByTestId("aws-saved")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await settle();
    expect(screen.getByTestId("aws-connection-changed")).toBeEmptyDOMElement();
    expect(checkMock.mock.lastCall?.slice(0, 4)).toEqual([
      ORG,
      ARN,
      REV_1,
      true,
    ]);
  });

  it("AC-11 a 409 reloads the settings, keeps the draft and says so once", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock
      .mockResolvedValueOnce(hub())
      .mockResolvedValue(hub({ revision: REV_2, roleArn: OTHER_ARN }));
    checkMock.mockRejectedValue(
      new ApiError("AWS_CONNECTION_CHANGED", "changed", 409),
    );
    renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-test"));
    expect(
      await screen.findByText("โหลดข้อมูลล่าสุดแล้ว", { exact: false }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await settle();
    expect(screen.getByTestId("aws-role-arn")).toHaveValue(ARN);
    expect(screen.getByTestId("aws-connection-changed")).toBeEmptyDOMElement();
  });

  it("AC-11 a 409 on disconnect closes the dialog instead of offering to disconnect the new value", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock
      .mockResolvedValueOnce(hub({ roleArn: ARN, accountId: "111122223333" }))
      .mockResolvedValue(
        hub({ revision: REV_2, roleArn: OTHER_ARN, accountId: "111122223333" }),
      );
    disconnectMock.mockRejectedValue(
      new ApiError("AWS_CONNECTION_CHANGED", "changed", 409),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "ยกเลิกการเชื่อมต่อ" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "ยืนยันการยกเลิก",
      }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      screen.getByText("โหลดข้อมูลล่าสุดแล้ว", { exact: false }),
    ).toBeInTheDocument();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it("F1 the field keeps the saved value while the reload is pending and after it fails", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    const reload = Promise.withResolvers<AwsOrganization>();
    fetchMock.mockResolvedValueOnce(hub()).mockReturnValueOnce(reload.promise);
    checkMock.mockResolvedValue(passed);
    renderPage();
    const { user } = await typeArn(ARN);
    await user.click(screen.getByTestId("aws-test"));
    await user.click(await screen.findByTestId("aws-save"));
    expect(await screen.findByTestId("aws-saved")).toBeInTheDocument();
    await settle();
    expect(screen.getByTestId("aws-role-arn")).toHaveValue(ARN);
    await act(async () => {
      reload.reject(new ApiError("HTTP_500", "boom", 500));
      await reload.promise.catch(() => undefined);
    });
    expect(await screen.findByTestId("aws-refresh-error")).toBeInTheDocument();
    expect(screen.getByTestId("aws-role-arn")).toHaveValue(ARN);
    expect(screen.getByTestId("aws-connection-changed")).toBeEmptyDOMElement();
  });

  it("D6 saving the same ARN again does not hide a later change by another request", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    const saved = hub({ roleArn: ARN, accountId: "111122223333" });
    fetchMock
      .mockResolvedValueOnce(saved)
      .mockResolvedValueOnce(saved)
      .mockResolvedValue(
        hub({ revision: REV_2, roleArn: OTHER_ARN, accountId: "111122223333" }),
      );
    checkMock.mockResolvedValue(passed);
    const { queryClient } = renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("aws-test"));
    await user.click(await screen.findByTestId("aws-save"));
    await screen.findByTestId("aws-saved");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await typeArn("arn:aws:iam::111122223333:role/Draft");
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
    });
    await settle();
    expect(screen.getByTestId("aws-connection-changed")).toHaveTextContent(
      "การตั้งค่าถูกแก้ไขจากคำขออื่น",
    );
  });

  it("N2 AC-13 a 409 on disconnect after another request disconnected keeps focus in the form", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock
      .mockResolvedValueOnce(hub({ roleArn: ARN, accountId: "111122223333" }))
      .mockResolvedValue(hub({ revision: REV_2 }));
    disconnectMock.mockRejectedValue(
      new ApiError("AWS_CONNECTION_CHANGED", "changed", 409),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "ยกเลิกการเชื่อมต่อ" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "ยืนยันการยกเลิก",
      }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "ยกเลิกการเชื่อมต่อ" }),
      ).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute(
        "aria-label",
        "ตั้งค่าการเชื่อมต่อ AWS",
      );
    });
  });

  it("D6 disconnect sends the loaded revision", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock.mockResolvedValue(
      hub({ roleArn: ARN, accountId: "111122223333" }),
    );
    disconnectMock.mockResolvedValue(undefined);
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "ยกเลิกการเชื่อมต่อ" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "ยืนยันการยกเลิก",
      }),
    );
    await waitFor(() => {
      expect(disconnectMock).toHaveBeenCalledWith(
        ORG,
        REV_1,
        expect.any(AbortSignal),
      );
    });
  });
});

describe("F-013 AC-05 AC-13 Role ARN field error", () => {
  it("shows a text error bound to the field for a malformed ARN", async () => {
    fetchMeContextMock.mockResolvedValue(meContext("owner"));
    fetchMock.mockResolvedValue(hub());
    renderPage();
    const { input } = await typeArn("arn:aws:iam::123:role/x");
    const error = screen.getByTestId("aws-role-arn-error");
    expect(error).toHaveTextContent("Role ARN ไม่ถูกรูปแบบ");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(
      error.id,
    );
    await typeArn(ARN);
    expect(screen.queryByTestId("aws-role-arn-error")).toBeNull();
  });
});
