import { cpeNameSchema, purlSchema } from "@nightwatch/api-contract";
import { createDatabase, type Database } from "@nightwatch/db";
import { z } from "zod";

import { identityKey } from "../inventory/rows";

// The only writer of catalog_product_mappings (Q-05): an operator of NightWatch
// confirms one "vendor and product string to CPE or purl" pair at a time, over the
// owner role and never over HTTP. The row holds no Organization, Project, version or
// user, so nothing about a customer reaches the shared catalog.

const text = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/[\p{Cc}\s]+/gu, " ").trim())
    .pipe(z.string().min(1).max(max));

const argsSchema = z
  .object({
    vendor: text(200),
    product: text(200),
    cpe: cpeNameSchema.optional(),
    purl: purlSchema.optional(),
  })
  .refine((args) => args.cpe !== undefined || args.purl !== undefined, {
    message: "give --cpe or --purl",
  });

export type CatalogMappingArgs = z.infer<typeof argsSchema>;

export function usage(): string {
  return [
    "Usage: catalog-product-mapping --vendor <vendor> --product <product> \\",
    "  [--cpe <CPE 2.3 name>] [--purl <purl>]",
    "",
    "Confirms one vendor and product pair in the shared catalog. A Project that",
    "uploads that pair next gets it confirmed without review. Re-running with the",
    "same pair replaces its CPE and purl.",
  ].join("\n");
}

export function parseCatalogArgs(argv: string[]): CatalogMappingArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) break;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 2)
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    else if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} needs a value\n\n${usage()}`);
      }
      flags.set(arg.slice(2), value);
      i += 1;
    } else throw new Error(`unexpected argument ${arg}\n\n${usage()}`);
  }
  const parsed = argsSchema.safeParse({
    vendor: flags.get("vendor"),
    product: flags.get("product"),
    cpe: flags.get("cpe"),
    purl: flags.get("purl"),
  });
  if (!parsed.success) {
    throw new Error(
      `${parsed.error.issues.map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`).join("\n")}\n\n${usage()}`,
    );
  }
  return parsed.data;
}

export async function upsertCatalogMapping(
  database: Database,
  args: CatalogMappingArgs,
): Promise<{ vendorKey: string; productKey: string }> {
  const vendorKey = identityKey(args.vendor);
  const productKey = identityKey(args.product);
  await database.sql.query(
    `insert into catalog_product_mappings (vendor_key, product_key, cpe, purl)
     values ($1, $2, $3, $4)
     on conflict (vendor_key, product_key) do update set cpe = $3, purl = $4`,
    [vendorKey, productKey, args.cpe ?? null, args.purl ?? null],
  );
  return { vendorKey, productKey };
}

if (import.meta.main) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) {
    console.error(
      "DATABASE_OWNER_URL is required (the owner role writes the catalog)",
    );
    process.exit(1);
  }
  let args: CatalogMappingArgs;
  try {
    args = parseCatalogArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const database = createDatabase(url);
  try {
    const { vendorKey, productKey } = await upsertCatalogMapping(
      database,
      args,
    );
    console.log(`confirmed ${vendorKey} / ${productKey}`);
  } finally {
    await database.close();
  }
}
