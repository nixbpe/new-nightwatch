import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type SelfSignedCertificate = { key: string; cert: string };

const opensslTime = (date: Date): string =>
  `${date.toISOString().slice(0, 19).replace(/[-:T]/g, "")}Z`;

/**
 * Self-signed certificates for `host` made with the openssl CLI: one valid and
 * one that expired in January 2020. Trust both through the outbound `ca` dep.
 */
export function createSelfSignedCertificates(host: string): {
  valid: SelfSignedCertificate;
  expired: SelfSignedCertificate;
  ca: string[];
  dispose: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "nw-api-test-certs-"));
  mkdirSync(join(dir, "newcerts"));
  writeFileSync(join(dir, "index.txt"), "");
  writeFileSync(join(dir, "serial"), "01\n");
  writeFileSync(
    join(dir, "ca.cnf"),
    [
      "[ca]",
      "default_ca = local",
      "[local]",
      `dir = ${dir}`,
      "database = $dir/index.txt",
      "new_certs_dir = $dir/newcerts",
      "serial = $dir/serial",
      "default_md = sha256",
      "policy = any",
      "unique_subject = no",
      "[any]",
      "commonName = supplied",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "ext"), `subjectAltName=DNS:${host}\n`);
  const openssl = (...args: string[]) =>
    execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  const issue = (name: string, notBefore: Date, notAfter: Date) => {
    openssl(
      "req",
      "-new",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      `${name}.key`,
      "-out",
      `${name}.csr`,
      "-subj",
      `/CN=${host}`,
    );
    openssl(
      "ca",
      "-batch",
      "-notext",
      "-selfsign",
      "-config",
      "ca.cnf",
      "-keyfile",
      `${name}.key`,
      "-in",
      `${name}.csr`,
      "-out",
      `${name}.crt`,
      "-extfile",
      "ext",
      "-startdate",
      opensslTime(notBefore),
      "-enddate",
      opensslTime(notAfter),
    );
    return {
      key: readFileSync(join(dir, `${name}.key`), "utf8"),
      cert: readFileSync(join(dir, `${name}.crt`), "utf8"),
    };
  };
  const day = 86_400_000;
  const valid = issue(
    "valid",
    new Date(Date.now() - day),
    new Date(Date.now() + 30 * day),
  );
  const expired = issue(
    "expired",
    new Date("2020-01-01T00:00:00Z"),
    new Date("2020-01-02T00:00:00Z"),
  );
  return {
    valid,
    expired,
    ca: [valid.cert, expired.cert],
    dispose: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
