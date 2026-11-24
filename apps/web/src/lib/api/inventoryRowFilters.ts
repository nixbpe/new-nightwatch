import {
  INVENTORY_ENVIRONMENTS,
  INVENTORY_EXPOSURES,
  INVENTORY_FIELD_MAX_LENGTH,
  INVENTORY_LAYERS,
  inventoryRowStatusSchema,
  type InventoryRowsQuery,
  type InventoryRowStatus,
} from "@nightwatch/api-contract";
import { z } from "zod";

type Layer = (typeof INVENTORY_LAYERS)[number];
type Environment = (typeof INVENTORY_ENVIRONMENTS)[number];
type Exposure = (typeof INVENTORY_EXPOSURES)[number];

export type RowFilters = {
  system: string;
  layer: "" | Layer;
  environment: "" | Environment;
  exposure: "" | Exposure;
  owner: string;
  status: InventoryRowStatus;
  q: string;
  page: number;
};

export const NO_FILTERS: RowFilters = {
  system: "",
  layer: "",
  environment: "",
  exposure: "",
  owner: "",
  status: "all",
  q: "",
  page: 1,
};

/** The URL is the state of the table, so each value is checked and a bad one falls back alone. */
export function readFilters(params: URLSearchParams): RowFilters {
  const system = z.uuid().safeParse(params.get("system"));
  const layer = z.enum(INVENTORY_LAYERS).safeParse(params.get("layer"));
  const environment = z
    .enum(INVENTORY_ENVIRONMENTS)
    .safeParse(params.get("environment"));
  const exposure = z
    .enum(INVENTORY_EXPOSURES)
    .safeParse(params.get("exposure"));
  const status = inventoryRowStatusSchema.safeParse(params.get("status"));
  const page = z.coerce.number().int().min(1).safeParse(params.get("page"));
  return {
    system: system.success ? system.data.toLowerCase() : "",
    layer: layer.success ? layer.data : "",
    environment: environment.success ? environment.data : "",
    exposure: exposure.success ? exposure.data : "",
    owner: (params.get("owner") ?? "")
      .trim()
      .slice(0, INVENTORY_FIELD_MAX_LENGTH),
    status: status.success ? status.data : "all",
    q: (params.get("q") ?? "").trim().slice(0, INVENTORY_FIELD_MAX_LENGTH),
    page: page.success ? page.data : 1,
  };
}

/** Defaults are left out so the address of an unfiltered table stays plain. */
export function writeFilters(filters: RowFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.system !== "") params.set("system", filters.system);
  if (filters.layer !== "") params.set("layer", filters.layer);
  if (filters.environment !== "")
    params.set("environment", filters.environment);
  if (filters.exposure !== "") params.set("exposure", filters.exposure);
  if (filters.owner !== "") params.set("owner", filters.owner);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.q !== "") params.set("q", filters.q);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export const hasFilters = (filters: RowFilters) =>
  filters.system !== "" ||
  filters.layer !== "" ||
  filters.environment !== "" ||
  filters.exposure !== "" ||
  filters.owner !== "" ||
  filters.status !== "all" ||
  filters.q !== "";

export function toQuery(filters: RowFilters): InventoryRowsQuery {
  return {
    ...(filters.system === "" ? {} : { system: filters.system }),
    ...(filters.layer === "" ? {} : { layer: filters.layer }),
    ...(filters.environment === "" ? {} : { environment: filters.environment }),
    ...(filters.exposure === "" ? {} : { exposure: filters.exposure }),
    ...(filters.owner === "" ? {} : { owner: filters.owner }),
    status: filters.status,
    ...(filters.q === "" ? {} : { q: filters.q }),
    page: filters.page,
  };
}
