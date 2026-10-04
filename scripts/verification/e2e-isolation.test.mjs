import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { createDatabase } from "../../packages/db/src/index.ts";
import { createRedisClient } from "../../apps/api/src/rate-limit/redis.ts";
import { createRateLimiter } from "../../apps/api/src/rate-limit/limiter.ts";
import {
  createDispatchQueue,
  redisConnection,
} from "../../apps/worker/src/dispatch.ts";
import { createMonitorCheckQueue } from "../../apps/worker/src/monitor/queue.ts";
import { resolveDevEnv } from "../dev-env.mjs";

const { Worker } = createRequire(
  new URL("../../apps/worker/package.json", import.meta.url),
)("bullmq");
const { env } = resolveDevEnv();

async function bootstrap(action, name, overrides = {}) {
  const child = Bun.spawn(
    [process.execPath, "scripts/e2e-database.mjs", action, name],
    { env: { ...env, ...overrides }, stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("shared services isolate schema, queue jobs, Lua rate limits, and cleanup", async () => {
  const names = [0, 1].map(() => `nw_e2e_${randomUUID().replaceAll("-", "")}`);
  const source = createDatabase(env.DATABASE_OWNER_URL);
  const redis = createRedisClient(env.REDIS_URL);
  const databases = [];
  const runtimeDatabases = [];
  const scopedRedis = [];
  const queues = [];
  const workers = [];
  const sentinel = `e2e-isolation-dev-${randomUUID()}`;
  const rolesBefore = (
    await source.sql.query(
      "select rolname, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname like 'nightwatch%' order by rolname",
    )
  ).rows;
  try {
    await redis.set(sentinel, "dev value", "EX", 60);
    const sourceLedger = (
      await source.sql.query(
        "select name, sha256 from __nightwatch_migrations order by name",
      )
    ).rows;
    for (const name of names) {
      const prepared = await bootstrap("prepare", name);
      expect(prepared.code, prepared.stderr).toBe(0);
      const namespace = JSON.parse(prepared.stdout);
      expect(namespace.REDIS_KEY_PREFIX).toBe(name);
      expect(namespace.REDIS_URL).toBe(env.REDIS_URL);
      const db = createDatabase(namespace.DATABASE_OWNER_URL);
      databases.push(db);
      runtimeDatabases.push(createDatabase(namespace.DATABASE_URL));
      expect(
        (
          await db.sql.query(
            "select name, sha256 from __nightwatch_migrations order by name",
          )
        ).rows,
      ).toEqual(sourceLedger);
      expect(
        (await db.sql.query('select count(*)::int as n from "user"')).rows,
      ).toEqual([{ n: 0 }]);
      const client = createRedisClient(env.REDIS_URL, undefined, name);
      scopedRedis.push(client);
    }
    const organization = randomUUID();
    await databases[0].sql.query(
      "insert into organization (id, name, slug, created_at, updated_at) values ($1, 'only first database', $2, now(), now())",
      [organization, organization],
    );
    for (const db of [source, databases[1]]) {
      expect(
        (
          await db.sql.query(
            "select count(*)::int as n from organization where id = $1",
            [organization],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    }
    for (const db of runtimeDatabases) {
      expect(
        (
          await db.sql.query(
            "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
          )
        ).rows,
      ).toEqual([{ rolsuper: false, rolbypassrls: false }]);
      expect(
        (
          await db.sql.query(
            "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'monitors'",
          )
        ).rows,
      ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    }
    const request = { key: "same-rate-limit-key", limit: 1, windowMs: 60_000 };
    const limiterA = createRateLimiter({ redis: scopedRedis[0] });
    const limiterB = createRateLimiter({ redis: scopedRedis[1] });
    expect(await limiterA.consumeRateLimit(request)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect((await limiterA.consumeRateLimit(request)).allowed).toBe(false);
    expect(await limiterB.consumeRateLimit(request)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(await redis.exists(request.key)).toBe(0);

    for (const createQueue of [createDispatchQueue, createMonitorCheckQueue]) {
      const deliveries = [[], []];
      for (const [index, name] of names.entries()) {
        const queue = createQueue(env.REDIS_URL, { prefix: name });
        queues.push(queue);
        const worker = new Worker(
          queue.name,
          async (job) => {
            deliveries[index].push(job.data.marker);
          },
          { connection: redisConnection(env.REDIS_URL), prefix: name },
        );
        workers.push(worker);
        await worker.waitUntilReady();
        await queue.add(
          "isolation",
          { marker: `namespace ${index}` },
          { removeOnComplete: true },
        );
      }
      for (
        let attempt = 0;
        attempt < 100 && deliveries.some((items) => items.length === 0);
        attempt++
      )
        await Bun.sleep(50);
      expect(deliveries).toEqual([["namespace 0"], ["namespace 1"]]);
    }
  } finally {
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all(queues.map((queue) => queue.close()));
    await Promise.all(
      [...databases, ...runtimeDatabases].map((db) => db.close()),
    );
    for (const client of scopedRedis) client.disconnect();
    for (const name of names) {
      const cleaned = await bootstrap("cleanup", name);
      expect(cleaned.code, cleaned.stderr).toBe(0);
      expect(
        (
          await source.sql.query(
            "select count(*)::int as n from pg_database where datname = $1",
            [name],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
      expect(await redis.keys(`${name}:*`)).toEqual([]);
    }
    expect(
      (
        await source.sql.query(
          "select rolname, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname like 'nightwatch%' order by rolname",
        )
      ).rows,
    ).toEqual(rolesBefore);
    expect(await redis.get(sentinel)).toBe("dev value");
    await redis.del(sentinel);
    redis.disconnect();
    await source.close();
  }
}, 30_000);

test("bootstrap refuses ambient databases and unsafe cleanup names", async () => {
  const name = `nw_e2e_${randomUUID().replaceAll("-", "")}`;
  const foreign = await bootstrap("prepare", name, {
    DATABASE_OWNER_URL: "postgres://foreign/database",
  });
  expect(foreign.code).toBe(1);
  expect(foreign.stderr).toContain("this worktree's local Compose");
  const unsafe = await bootstrap("cleanup", "nightwatch");
  expect(unsafe.code).toBe(1);
  expect(unsafe.stderr).toContain("Expected prepare|cleanup");
});
