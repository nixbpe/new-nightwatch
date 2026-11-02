import { describe, expect, it } from "vitest";

import { getBreadcrumbTrail } from "./breadcrumb";
import {
  getNavDestinations,
  getAllNavLeaves,
  getRouteOrganizationId,
  getProjectRoute,
  mostSpecificLeaf,
  projectSwitchDestination,
  resolveNavPath,
} from "./nav-config";

const ORG = "11111111-1111-4111-8111-111111111111";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("resolveNavPath", () => {
  it("fills the organization and the Project, and gives null while either is unknown", () => {
    const path = "/organizations/:organizationId/projects/:projectId/members";
    expect(resolveNavPath(path, ORG, P1)).toBe(
      `/organizations/${ORG}/projects/${P1}/members`,
    );
    expect(resolveNavPath(path, ORG, null)).toBeNull();
    expect(resolveNavPath(path, null, P1)).toBeNull();
    expect(resolveNavPath("/workspace", null, null)).toBe("/workspace");
  });
});

describe("getProjectRoute", () => {
  it("names the Organization and Project of a Project route, and nothing for other routes", () => {
    expect(
      getProjectRoute(`/organizations/${ORG}/projects/${P1}/members`),
    ).toEqual({ organizationId: ORG, projectId: P1 });
    expect(
      getProjectRoute(
        `/organizations/${ORG}/projects/${P1.toUpperCase()}/members`,
      ),
    ).toEqual({ organizationId: ORG, projectId: P1 });
    expect(
      getProjectRoute(
        `/ORGANIZATIONS/${ORG}/PROJECTS/${P1.toUpperCase()}/MEMBERS`,
      ),
    ).toEqual({ organizationId: ORG, projectId: P1 });
    expect(getProjectRoute(`/organizations/${ORG}/projects`)).toBeNull();
    expect(getProjectRoute("/workspace")).toBeNull();
  });

  it("keeps the organization readable from a Project route", () => {
    expect(
      getRouteOrganizationId(`/organizations/${ORG}/projects/${P1}/members`),
    ).toBe(ORG);
  });
});

describe("mostSpecificLeaf", () => {
  it("prefers the longest matching path", () => {
    const leaves = [
      { path: "/organizations/:organizationId/projects" },
      { path: "/organizations/:organizationId/projects/:projectId/members" },
    ];
    expect(
      mostSpecificLeaf(leaves, `/organizations/${ORG}/projects/${P1}/members`)
        ?.path,
    ).toBe(leaves[1]?.path);
    expect(
      mostSpecificLeaf(leaves, `/organizations/${ORG}/projects`)?.path,
    ).toBe(leaves[0]?.path);
    expect(mostSpecificLeaf(leaves, "/workspace")).toBeUndefined();
  });
});

describe("projectSwitchDestination (AC-04)", () => {
  it("keeps the same page in the new Project", () => {
    expect(
      projectSwitchDestination(
        `/organizations/${ORG}/projects/${P1}/members`,
        ORG,
        P2,
      ),
    ).toBe(`/organizations/${ORG}/projects/${P2}/members`);
  });

  it("lands on the overview, the first Project page, from anywhere else", () => {
    const landing = `/organizations/${ORG}/projects/${P2}/overview`;
    expect(projectSwitchDestination("/workspace", ORG, P2)).toBe(landing);
    expect(
      projectSwitchDestination(`/organizations/${ORG}/projects`, ORG, P2),
    ).toBe(landing);
    expect(
      projectSwitchDestination(
        `/organizations/${ORG}/projects/${P1}/unknown-page`,
        ORG,
        P2,
      ),
    ).toBe(landing);
  });

  it("sends a monitor detail, edit or history page to the Project's monitor list", () => {
    const monitors = `/organizations/${ORG}/projects/${P2}/monitors`;
    for (const pathname of [
      `/organizations/${ORG}/projects/${P1}/monitors`,
      `/organizations/${ORG}/projects/${P1}/monitors/new`,
      `/organizations/${ORG}/projects/${P1}/monitors/9f1c`,
      `/organizations/${ORG}/projects/${P1}/monitors/9f1c/edit`,
      `/organizations/${ORG}/projects/${P1}/monitors/9f1c/checks`,
    ]) {
      expect(projectSwitchDestination(pathname, ORG, P2)).toBe(monitors);
    }
  });

  it("keeps the members page apart from the monitors", () => {
    expect(
      projectSwitchDestination(
        `/organizations/${ORG}/projects/${P1}/members`,
        ORG,
        P2,
      ),
    ).toBe(`/organizations/${ORG}/projects/${P2}/members`);
  });
});

describe("Project scope in the navigation definition", () => {
  const context = { organizationId: ORG, role: "owner" } as const;

  it("omits the workspace redirect from sidebar leaves and palette destinations", () => {
    expect(getAllNavLeaves().some((leaf) => leaf.path === "/workspace")).toBe(
      false,
    );
    expect(
      getNavDestinations({ ...context, projectId: P1 }).some(
        (leaf) => leaf.path === "/workspace",
      ),
    ).toBe(false);
  });

  it("resolves Project pages in the Project's own Organization, other pages in the active one", () => {
    const other = "99999999-9999-4999-8999-999999999999";
    const destinations = getNavDestinations({
      ...context,
      projectId: P1,
      projectOrganizationId: other,
    });
    expect(
      destinations
        .filter((destination) => destination.group === "โปรเจกต์")
        .map((destination) => destination.path),
    ).toEqual([
      `/organizations/${other}/projects/${P1}/overview`,
      `/organizations/${other}/projects/${P1}/monitors`,
      `/organizations/${other}/projects/${P1}/members`,
    ]);
    expect(
      destinations.find((destination) => destination.label === "สมาชิก")?.path,
    ).toBe(`/organizations/${ORG}/members`);
  });

  it("lists Project pages in the palette only for the current Project", () => {
    expect(
      getNavDestinations({ ...context, projectId: P1 }).filter(
        (destination) => destination.group === "โปรเจกต์",
      ),
    ).toEqual([
      {
        label: "ภาพรวม",
        icon: "activity",
        path: `/organizations/${ORG}/projects/${P1}/overview`,
        group: "โปรเจกต์",
      },
      {
        label: "ตรวจสถานะบริการ",
        icon: "activity",
        path: `/organizations/${ORG}/projects/${P1}/monitors`,
        group: "โปรเจกต์",
      },
      {
        label: "สมาชิกโปรเจกต์",
        icon: "users",
        path: `/organizations/${ORG}/projects/${P1}/members`,
        group: "โปรเจกต์",
      },
    ]);
    expect(
      getNavDestinations({ ...context, projectId: null }).some(
        (destination) => destination.group === "โปรเจกต์",
      ),
    ).toBe(false);
  });

  it("names the monitor list on every monitor page of a Project", () => {
    for (const page of ["", "/new", "/9f1c", "/9f1c/edit", "/9f1c/checks"]) {
      expect(
        getBreadcrumbTrail(
          `/organizations/${ORG}/projects/${P1}/monitors${page}`,
        ).map((crumb) => crumb.label),
      ).toEqual(["ตรวจสถานะบริการ"]);
    }
    expect(
      getRouteOrganizationId(
        `/organizations/${ORG}/projects/${P1}/monitors/9f1c`,
      ),
    ).toBe(ORG);
  });

  it("names the Project page, not the Project list, on a Project route", () => {
    expect(
      getBreadcrumbTrail(`/organizations/${ORG}/projects/${P1}/members`).map(
        (crumb) => crumb.label,
      ),
    ).toEqual(["สมาชิกโปรเจกต์"]);
    expect(
      getBreadcrumbTrail(`/organizations/${ORG}/projects`).map(
        (crumb) => crumb.label,
      ),
    ).toEqual(["โปรเจกต์ทั้งหมด"]);
  });
});
