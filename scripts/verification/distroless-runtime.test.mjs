import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {{ api: string, worker: string, workerDev: string }} ImageSet */
/** @type {ImageSet} */
const images = {
  api: process.env.DISTROLESS_API_IMAGE,
  worker: process.env.DISTROLESS_WORKER_IMAGE,
  workerDev: process.env.DISTROLESS_WORKER_DEV_IMAGE,
};
if (Object.values(images).some((image) => !image?.trim())) {
  throw new Error(
    "Usage: DISTROLESS_API_IMAGE=<built-api> DISTROLESS_WORKER_IMAGE=<built-production-worker> DISTROLESS_WORKER_DEV_IMAGE=<built-development-worker> bun test scripts/verification/distroless-runtime.test.mjs. Preload postgres:17.11-alpine, redis:7.4.7-alpine and axllent/mailpit:v1.31.1. This test never builds or pulls images.",
  );
}
const prefix = `nw-distroless-${randomUUID()}`;
const roles = [
  "consumer",
  "scheduler",
  "monitor-scheduler",
  "monitor-checker",
  "audit-exporter",
];
const owned = new Set();
const active = new Set();
let directory, runtimeFile, checkerFile, postgres, api, cleanupPromise;
let interrupted = false;

function capture(args, timeout = 20_000) {
  return new Promise((resolve) => {
    execFile(
      "docker",
      args,
      { timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : -1) : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}
async function docker(args, timeout) {
  if (interrupted) throw new Error("Distroless verification interrupted");
  const operation = capture(args, timeout);
  active.add(operation);
  try {
    return await operation;
  } finally {
    active.delete(operation);
  }
}
function success(result) {
  if (result.code !== 0)
    throw new Error(
      `Docker operation failed with exit ${result.code}; command arguments and output withheld`,
    );
  return result.stdout.trim();
}
async function run(image, options = [], command = [], timeout) {
  const name = `${prefix}-${owned.size}`;
  owned.add(name);
  const result = await docker(
    [
      "run",
      "--pull=never",
      `--name=${name}`,
      `--network=${prefix}`,
      ...options,
      image,
      ...command,
    ],
    timeout,
  );
  return { ...result, name };
}
async function inspect(name) {
  return JSON.parse(success(await docker(["inspect", name])))[0];
}
async function until(check, label, timeout = 40_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function envFile(name, values) {
  const path = join(directory, name);
  await writeFile(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  return path;
}
function cleanup() {
  interrupted = true;
  return (cleanupPromise ??= (async () => {
    await Promise.allSettled([...active]);
    let failed = false;
    for (const name of owned) {
      const result = await capture(["rm", "--force", "--volumes", name]);
      if (result.code !== 0 && !result.stderr.includes("No such container"))
        failed = true;
    }
    const network = await capture(["network", "rm", prefix]);
    if (network.code !== 0 && !network.stderr.includes("not found"))
      failed = true;
    if (directory) await rm(directory, { recursive: true, force: true });
    if (failed) throw new Error("Owned fixture cleanup failed");
  })());
}
const onInterrupt = (signal) => {
  interrupted = true;
  void cleanup().then(
    () => process.exit(signal === "SIGTERM" ? 143 : 130),
    () => process.exit(1),
  );
};
process.once("SIGINT", onInterrupt);
process.once("SIGTERM", onInterrupt);
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
}, 120_000);

beforeAll(async () => {
  try {
    directory = await mkdtemp(join(tmpdir(), `${prefix}-`));
    const ownerPassword = randomBytes(32).toString("hex");
    const runtimePassword = randomBytes(32).toString("hex");
    const bootstrapFile = await envFile("postgres.env", {
      POSTGRES_DB: "nightwatch",
      POSTGRES_USER: "nightwatch_owner",
      POSTGRES_PASSWORD: ownerPassword,
      PGPASSWORD: ownerPassword,
      NW_DB_PASSWORD: runtimePassword,
    });
    const migrationFile = await envFile("migration.env", {
      DATABASE_OWNER_URL: `postgres://nightwatch_owner:${ownerPassword}@db:5432/nightwatch`,
    });
    const runtimeEnv = {
      DATABASE_URL: `postgres://nightwatch:${runtimePassword}@db:5432/nightwatch`,
      APP_URL: "http://localhost:5173",
      BETTER_AUTH_URL: "http://localhost:4000",
      CORS_ORIGIN: "http://localhost:5173",
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      SMTP_HOST: "mailpit",
      SMTP_PORT: "1025",
      SMTP_SECURE: "false",
      SMTP_FROM: "fixture@nightwatch.invalid",
      REDIS_URL: "redis://redis:6379",
      REDIS_KEY_PREFIX: prefix,
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        fixture: randomBytes(32).toString("base64"),
      }),
      CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: "fixture",
    };
    runtimeFile = await envFile("runtime.env", runtimeEnv);
    const withoutKeys = { ...runtimeEnv };
    delete withoutKeys.CREDENTIAL_ENCRYPTION_KEYS;
    delete withoutKeys.CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION;
    checkerFile = await envFile("checker.env", withoutKeys);
    success(await docker(["network", "create", "--internal", prefix]));
    const init = fileURLToPath(
      new URL("../db/init/001-roles.sh", import.meta.url),
    );
    const pg = await run("postgres:17.11-alpine", [
      "-d",
      "--network-alias=db",
      `--env-file=${bootstrapFile}`,
      `--mount=type=bind,src=${init},dst=/docker-entrypoint-initdb.d/001-roles.sh,readonly`,
    ]);
    success(pg);
    postgres = pg.name;
    await until(async () => {
      const result = await docker([
        "exec",
        postgres,
        "psql",
        "-h",
        "127.0.0.1",
        "-U",
        "nightwatch_owner",
        "-d",
        "nightwatch",
        "-tAc",
        "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nightwatch' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole)",
      ]);
      return result.code === 0 && result.stdout.trim() === "t";
    }, "PostgreSQL runtime role");
    const redis = await run("redis:7.4.7-alpine", [
      "-d",
      "--network-alias=redis",
    ]);
    success(redis);
    await until(async () => {
      const result = await docker(["exec", redis.name, "redis-cli", "ping"]);
      return result.code === 0 && result.stdout.trim() === "PONG";
    }, "Redis");
    success(
      await run("axllent/mailpit:v1.31.1", ["-d", "--network-alias=mailpit"]),
    );
    const migration = await run(
      images.api,
      ["--rm", `--env-file=${migrationFile}`],
      ["bun", "dist-migrate/migrate.js"],
      90_000,
    );
    expect(migration.code).toBe(0);
    expect(migration.stdout.includes("db migrate: done (")).toBe(true);
    success(
      await docker([
        "exec",
        postgres,
        "psql",
        "-U",
        "nightwatch_owner",
        "-d",
        "nightwatch",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "SELECT ensure_monitor_partitions(3); SELECT ensure_audit_event_partitions(3);",
      ]),
    );
    const server = await run(images.api, [
      "-d",
      `--env-file=${runtimeFile}`,
      "--health-interval=1s",
      "--health-start-period=1s",
      "--health-retries=1",
    ]);
    success(server);
    api = server.name;
    await until(
      async () => (await inspect(api)).State.Health?.Status === "healthy",
      "API healthcheck",
    );
  } catch (error) {
    await cleanup();
    throw error;
  }
}, 180_000);

for (const [flavor, image] of Object.entries(images)) {
  test(`${flavor} runs Bun 1.4.3 as 1001:1001 without shell/package/download tools`, async () => {
    const probe = `const {existsSync}=await import('node:fs'); console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),bun:Bun.version,marker:existsSync('/etc/nightwatch-worker-dev-build'),tools:['/bin/sh','/bin/bash','/usr/bin/id','/usr/bin/apt','/usr/bin/apt-get','/apk','/sbin/apk','/usr/bin/apk','/wget','/bin/wget','/usr/bin/wget'].filter(existsSync)}));`;
    const result = await run(
      image,
      ["--rm", "--entrypoint=bun"],
      ["-e", probe],
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      uid: 1001,
      gid: 1001,
      bun: "1.4.3",
      marker: flavor === "workerDev",
      tools: [],
    });
    const metadata = JSON.parse(
      success(await docker(["image", "inspect", image])),
    )[0];
    expect(metadata.Config.User).toBe("1001:1001");
    const denied = await run(
      image,
      ["--rm", "--entrypoint=bun"],
      [
        "-e",
        `import fs from 'node:fs';for(const path of ['/etc/nightwatch-worker-dev-build','/app/worker-entrypoint.mjs']){try{fs.writeFileSync(path,'fixture-tamper');process.exit(99);}catch(error){if(error.code!=='EACCES')throw error;}}console.log('startup-files-write-denied');`,
      ],
    );
    expect(denied.code).toBe(0);
    expect(denied.stdout.trim()).toBe("startup-files-write-denied");
  }, 30_000);
}

/** @typedef {{flavor: 'worker'|'workerDev', nodeEnv: string, spoof?: boolean, exit: 78}} TestCase */
/** @type {TestCase[]} */
const gateCases = [
  { flavor: "worker", nodeEnv: "", exit: 78 },
  { flavor: "worker", nodeEnv: "development", exit: 78 },
  { flavor: "worker", nodeEnv: "test", exit: 78 },
  { flavor: "worker", nodeEnv: "development", spoof: true, exit: 78 },
  { flavor: "workerDev", nodeEnv: "", exit: 78 },
  { flavor: "workerDev", nodeEnv: "test", exit: 78 },
];
for (const entry of gateCases) {
  test(`${entry.flavor} rejects NODE_ENV=${JSON.stringify(entry.nodeEnv)}${entry.spoof ? " despite runtime flavor spoof" : ""} before application import`, async () => {
    const options = ["--rm", "-e", `NODE_ENV=${entry.nodeEnv}`];
    if (entry.spoof) options.push("-e", "WORKER_ALLOW_DEVELOPMENT=1");
    const result = await run(images[entry.flavor], options);
    expect(result.code).toBe(entry.exit);
    expect(result.stderr.includes("nightwatch-worker:")).toBe(true);
    expect(result.stderr.includes("refusing to start")).toBe(true);
    expect(result.stderr.includes("DATABASE_URL must be configured")).toBe(
      false,
    );
  }, 30_000);
}

test("production defaults reach the application, and checker refuses missing production keys", async () => {
  const missingDb = await run(images.worker, ["--rm"]);
  expect(missingDb.code).toBe(1);
  expect(missingDb.stderr.includes("DATABASE_URL must be configured")).toBe(
    true,
  );
  const checker = await run(images.worker, [
    "--rm",
    `--env-file=${checkerFile}`,
    "-e",
    "WORKER_ROLES=monitor-checker",
  ]);
  expect(checker.code).toBe(1);
  expect(
    checker.stderr.includes(
      "CREDENTIAL_ENCRYPTION_KEYS is required in production",
    ),
  ).toBe(true);
}, 50_000);

test("API command override, HTTP health and configured healthy/unhealthy probes execute without a shell", async () => {
  const override = await run(
    images.api,
    ["--rm"],
    ["bun", "-e", "console.log('api-override-ok')"],
  );
  expect(override.code).toBe(0);
  expect(override.stdout.trim()).toBe("api-override-ok");
  const metadata = await inspect(api);
  expect(
    metadata.Config.Env.some((value) =>
      value.startsWith("DATABASE_OWNER_URL="),
    ),
  ).toBe(false);
  const health = metadata.Config.Healthcheck.Test;
  expect(health[0]).toBe("CMD");
  expect((await docker(["exec", api, ...health.slice(1)])).code).toBe(0);
  const response = await docker([
    "exec",
    api,
    "bun",
    "-e",
    "const r=await fetch('http://127.0.0.1:4000/health'); console.log(JSON.stringify({status:r.status,body:await r.json()}));",
  ]);
  expect(JSON.parse(success(response))).toEqual({
    status: 200,
    body: { status: "ok" },
  });
  const auth = await docker([
    "exec",
    api,
    "bun",
    "-e",
    `const r=await fetch('http://127.0.0.1:4000/api/auth/sign-in/email', {
      method:'POST', headers:{'content-type':'application/json',origin:process.env.APP_URL},
      body:JSON.stringify({email:'absent@nightwatch.invalid',password:'fixture-absent-password'})
    }); console.log(JSON.stringify({status:r.status,code:(await r.json()).code}));`,
  ]);
  expect(JSON.parse(success(auth))).toEqual({
    status: 401,
    code: "INVALID_EMAIL_OR_PASSWORD",
  });
  for (const [label, program] of [
    ["no server", "setInterval(()=>{},1000)"],
    [
      "HTTP 503",
      "Bun.serve({port:4000,fetch:()=>new Response('unavailable',{status:503})})",
    ],
  ]) {
    const rejectedServer = await run(
      images.api,
      [
        "-d",
        "--health-interval=1s",
        "--health-start-period=1s",
        "--health-retries=1",
      ],
      ["bun", "-e", program],
    );
    success(rejectedServer);
    await until(
      async () =>
        (await inspect(rejectedServer.name)).State.Health.Status ===
        "unhealthy",
      label,
    );
    expect(
      (await docker(["exec", rejectedServer.name, ...health.slice(1)])).code,
    ).toBe(1);
  }
}, 60_000);

test("both runtime images verify trusted TLS and reject an untrusted certificate", async () => {
  const key = join(directory, "tls-key.pem");
  const cert = join(directory, "tls-cert.pem");
  const certificate = Bun.spawn(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=tls-fixture",
      "-addext",
      "subjectAltName=DNS:tls-fixture",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [code] = await Promise.all([
    certificate.exited,
    new Response(certificate.stderr).text(),
  ]);
  expect(code).toBe(0);
  await Promise.all([chmod(cert, 0o644), chmod(key, 0o644)]);
  const server = await run(
    images.api,
    [
      "-d",
      "--network-alias=tls-fixture",
      `--mount=type=bind,src=${cert},dst=/fixture-cert.pem,readonly`,
      `--mount=type=bind,src=${key},dst=/fixture-key.pem,readonly`,
    ],
    [
      "bun",
      "-e",
      `Bun.serve({port:8443,tls:{cert:Bun.file('/fixture-cert.pem'),key:Bun.file('/fixture-key.pem')},fetch:()=>new Response('tls-ok')});console.log('TLS fixture ready');`,
    ],
  );
  success(server);
  await until(
    async () =>
      success(await docker(["logs", server.name])).includes(
        "TLS fixture ready",
      ),
    "TLS fixture",
  );
  const probe = `
    import tls from 'node:tls'; import {readFileSync} from 'node:fs';
    const connect=(ca)=>new Promise((resolve,reject)=>{
      const socket=tls.connect({host:'tls-fixture',port:8443,servername:'tls-fixture',rejectUnauthorized:true,...(ca?{ca}:{})});
      socket.setTimeout(5000,()=>socket.destroy(new Error('TLS fixture timeout')));
      socket.once('error',reject);
      socket.once('secureConnect',()=>{const trusted=socket.authorized;socket.end();if(trusted)resolve();else reject(new Error('TLS peer unauthorized'));});
    });
    await connect(readFileSync('/fixture-ca.pem'));
    let untrustedRejected=false;
    try {await connect();} catch(error) {
      if(!['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error.code))throw error;
      untrustedRejected=true;
    }
    if(!untrustedRejected)throw new Error('Untrusted TLS certificate was accepted');
    console.log(JSON.stringify({trusted:true,untrustedRejected}));
  `;
  for (const image of [images.api, images.worker]) {
    const result = await run(
      image,
      [
        "--rm",
        "--entrypoint=bun",
        `--mount=type=bind,src=${cert},dst=/fixture-ca.pem,readonly`,
      ],
      ["-e", probe],
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      trusted: true,
      untrustedRejected: true,
    });
  }
}, 60_000);

for (const flavor of ["worker", "workerDev"]) {
  test(`${flavor} starts all real roles, ignores id -u, and drains on SIGTERM within 30 seconds`, async () => {
    const worker = await run(
      images[flavor],
      [
        "-d",
        `--env-file=${flavor === "worker" ? runtimeFile : checkerFile}`,
        "-e",
        `NODE_ENV=${flavor === "worker" ? "production" : "development"}`,
        "-e",
        `WORKER_ROLES=${roles.join(",")}`,
      ],
      ["id", "-u"],
    );
    success(worker);
    let entries;
    await until(async () => {
      const logs = success(await docker(["logs", worker.name]));
      entries = logs
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line));
      return (
        entries.some(
          (entry) => entry.msg === "in-app materialize worker ready",
        ) && entries.some((entry) => entry.msg === "audit exporter ready")
      );
    }, `${flavor} readiness`);
    expect(
      entries.find((entry) => entry.msg === "in-app materialize worker ready")
        .roles,
    ).toEqual(roles);
    const identity = await docker([
      "exec",
      worker.name,
      "bun",
      "-e",
      "console.log(JSON.stringify([process.getuid(),process.getgid()]))",
    ]);
    expect(JSON.parse(success(identity))).toEqual([1001, 1001]);
    const start = Date.now();
    success(await docker(["stop", "--time", "29", worker.name], 35_000));
    expect(Date.now() - start).toBeLessThan(30_000);
    expect((await inspect(worker.name)).State.ExitCode).toBe(0);
    const logs = success(await docker(["logs", worker.name]));
    expect(logs.includes('"signal":"SIGTERM"')).toBe(true);
    expect(logs.includes("worker shutdown requested")).toBe(true);
    expect(logs.includes("monitor scheduler stopped")).toBe(true);
  }, 90_000);
}
