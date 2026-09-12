import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

function inventoryYaml({
  agents = 2,
  models = 2,
  skills = 1,
  commands = 1,
  files = 1,
} = {}) {
  return `referenceInventory:\n  agents: ${agents}\n  models: ${models}\n  skills: ${skills}\n  commands: ${commands}\n  files: ${files}\n`;
}

async function fixture({
  selector = "provider/model:medium",
  spawnsYaml = "spawns:\n  - worker",
  autoloadYaml = "",
  modelYaml = 'model: ["@review", "@default"]',
  refs = "agent:`worker` skill:`known` command:`/build` file:`AGENTS.md`\n```text\nagent:`missing-agent` skill:`missing-skill` file:`missing.md`\n```",
  inventory,
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agent-config-"));
  roots.push(root);
  await Promise.all([
    mkdir(path.join(root, ".omp/agents"), { recursive: true }),
    mkdir(path.join(root, ".omp/skills/known"), { recursive: true }),
    mkdir(path.join(root, ".omp/commands"), { recursive: true }),
  ]);
  await writeFile(path.join(root, "AGENTS.md"), "# Rules\n");
  await writeFile(
    path.join(root, ".omp/config.yml"),
    `modelRoles:\n  review: ${selector}\n${inventoryYaml(inventory)}`,
  );
  await writeFile(
    path.join(root, ".omp/agents/lead.md"),
    `---\nname: lead\n${spawnsYaml}\n${autoloadYaml}\n${modelYaml}\n---\n${refs}\n`,
  );
  await writeFile(
    path.join(root, ".omp/agents/worker.md"),
    "---\nname: worker\n---\n",
  );
  await writeFile(path.join(root, ".omp/skills/known/SKILL.md"), "# Known\n");
  await writeFile(
    path.join(root, ".omp/commands/build.md"),
    "---\ndescription: build\n---\n",
  );
  return root;
}

function check(root) {
  return Bun.spawnSync(
    ["bun", "scripts/quality/check-agent-config.mjs", "--root", root],
    {
      cwd: path.resolve(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

describe("agent config checker", () => {
  test("accepts multiline spawns, model lists and fenced examples", async () => {
    const result = check(await fixture());
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain(
      "2 agent refs, 2 model refs, 1 skill refs, 1 command refs, 1 file refs",
    );
  });

  test("accepts selectors without effort and scalar model frontmatter", async () => {
    const root = await fixture({
      selector: "provider/model",
      modelYaml: 'model: "@review"',
      inventory: { models: 1 },
    });
    const result = check(root);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  });

  test("rejects unknown and legacy references", async () => {
    const root = await fixture({
      selector: "provider/model:meduim",
      spawnsYaml: "spawns: [missing-agent]",
      refs: "agent:`missing-agent` skill:`missing-skill` command:`/missing-command` file:`missing.md` use `legacy-skill` skills see `known` follow `other.md` `/file` `/optional`",
    });
    const result = check(root);
    const error = result.stderr.toString();
    expect(result.exitCode).toBe(1);
    expect(error).toContain('unknown effort "meduim"');
    expect(error).toContain("spawns missing agent missing-agent");
    expect(error).toContain("missing skill missing-skill");
    expect(error).toContain("missing command /missing-command");
    expect(error).toContain("missing file missing.md");
    expect(error).toContain("legacy skill reference legacy-skill");
    expect(error).toContain("legacy skill reference known");
    expect(error).toContain("legacy file reference other.md");
    expect(error).not.toContain("/file");
    expect(error).not.toContain("/optional");
  });

  test("rejects traversal, implicit agents and external symlink references", async () => {
    const root = await fixture({
      spawnsYaml: "spawns: [../worker]",
      refs: "`worker` agent:`../worker` agent:`Code-reviewer` file:`external.md`",
    });
    const outside = await mkdtemp(path.join(tmpdir(), "agent-config-outside-"));
    roots.push(outside);
    const target = path.join(outside, "external.md");
    await writeFile(target, "# External\n");
    await symlink(target, path.join(root, "external.md"));
    const result = check(root);
    const error = result.stderr.toString();
    expect(result.exitCode).toBe(1);
    expect(error).toContain("invalid agent identity ../worker");
    expect(error).toContain("legacy agent reference worker");
    expect(error).toContain("invalid agent reference ../worker");
    expect(error).toContain("invalid agent reference Code-reviewer");
    expect(error).toContain("missing file external.md");
  });

  test("requires canonical SKILL.md files", async () => {
    const root = await fixture();
    await rm(path.join(root, ".omp/skills/known/SKILL.md"));
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing skill known");
  });

  test("rejects missing autoload skills", async () => {
    const root = await fixture({
      autoloadYaml: "autoloadSkills: [missing]",
      inventory: { skills: 2 },
    });
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "missing autoload skill missing",
    );
  });

  test("rejects symlinked agent inventory entries", async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), "agent-config-agent-"));
    roots.push(outside);
    const target = path.join(outside, "worker.md");
    await writeFile(target, "---\nname: worker\n---\n");
    const worker = path.join(root, ".omp/agents/worker.md");
    await rm(worker);
    await symlink(target, worker);
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("spawns missing agent worker");
    expect(result.stderr.toString()).toContain("missing agent worker");
  });

  test("rejects a symlinked agent inventory directory", async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), "agent-config-agents-"));
    roots.push(outside);
    await writeFile(
      path.join(outside, "lead.md"),
      '---\nname: lead\nspawns: [worker]\nmodel: ["@review"]\n---\n',
    );
    await writeFile(
      path.join(outside, "worker.md"),
      "---\nname: worker\n---\n",
    );
    const agents = path.join(root, ".omp/agents");
    await rm(agents, { recursive: true });
    await symlink(outside, agents);
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      ".omp/agents: markdown directory escapes repository",
    );
  });

  test("rejects a symlinked command inventory directory", async () => {
    const root = await fixture();
    const outside = await mkdtemp(
      path.join(tmpdir(), "agent-config-commands-"),
    );
    roots.push(outside);
    await writeFile(
      path.join(outside, "build.md"),
      "---\ndescription: external build\n---\n",
    );
    const commands = path.join(root, ".omp/commands");
    await rm(commands, { recursive: true });
    await symlink(outside, commands);
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      ".omp/commands: markdown directory escapes repository",
    );
    expect(result.stderr.toString()).toContain("missing command /build");
  });

  test("rejects an external config symlink", async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), "agent-config-config-"));
    roots.push(outside);
    const externalConfig = path.join(outside, "config.yml");
    await writeFile(
      externalConfig,
      `modelRoles:\n  review: provider/model:external\n${inventoryYaml()}`,
    );
    const configPath = path.join(root, ".omp/config.yml");
    await rm(configPath);
    await symlink(externalConfig, configPath);
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      ".omp/config.yml: config must be an in-repository regular file",
    );
    expect(result.stderr.toString()).not.toContain("unknown effort");
  });

  test("rejects an internal config symlink", async () => {
    const root = await fixture();
    const configPath = path.join(root, ".omp/config.yml");
    const target = path.join(root, ".omp/config-target.yml");
    await rename(configPath, target);
    await symlink(target, configPath);
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      ".omp/config.yml: config must be an in-repository regular file",
    );
  });

  test("rejects a symlinked config ancestor", async () => {
    const root = await fixture();
    const omp = path.join(root, ".omp");
    const target = path.join(root, ".omp-target");
    await rename(omp, target);
    await symlink(target, omp);
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      ".omp/config.yml: config must be an in-repository regular file",
    );
  });

  test("rejects malformed config and frontmatter shapes", async () => {
    const malformedConfig = await fixture();
    await writeFile(
      path.join(malformedConfig, ".omp/config.yml"),
      "modelRoles: [\n",
    );
    const configResult = check(malformedConfig);
    expect(configResult.exitCode).toBe(1);
    expect(configResult.stderr.toString()).toContain("malformed config.yml");

    const malformedFrontmatter = await fixture({
      spawnsYaml: "spawns: worker",
      modelYaml: "model:\n  nested: value",
    });
    const frontmatterResult = check(malformedFrontmatter);
    expect(frontmatterResult.exitCode).toBe(1);
    expect(frontmatterResult.stderr.toString()).toContain(
      "spawns must be a string list",
    );
    expect(frontmatterResult.stderr.toString()).toContain(
      "model must be a string or string list",
    );
  });

  test("rejects missing config and reference inventory drift", async () => {
    const missing = await fixture();
    await rm(path.join(missing, ".omp/config.yml"));
    const missingResult = check(missing);
    expect(missingResult.exitCode).toBe(1);
    expect(missingResult.stderr.toString()).toContain("missing config.yml");

    const drift = await fixture({ inventory: { agents: 99 } });
    const driftResult = check(drift);
    expect(driftResult.exitCode).toBe(1);
    expect(driftResult.stderr.toString()).toContain(
      "agents reference count 2 does not match inventory 99",
    );
  });
});
