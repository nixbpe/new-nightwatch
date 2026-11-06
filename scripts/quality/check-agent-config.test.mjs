import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

async function fixture({
  toolsYaml = "tools: Agent(worker), Read",
  skillsYaml = "",
  modelYaml = "model: opus",
  refs = "agent:`worker` skill:`known` command:`/build` file:`AGENTS.md`\n```text\nagent:`missing-agent` skill:`missing-skill` file:`missing.md`\n```",
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agent-config-"));
  roots.push(root);
  await Promise.all([
    mkdir(path.join(root, ".claude/agents"), { recursive: true }),
    mkdir(path.join(root, ".claude/skills/known"), { recursive: true }),
    mkdir(path.join(root, ".claude/skills/build"), { recursive: true }),
  ]);
  await writeFile(path.join(root, "AGENTS.md"), "# Rules\n");
  await writeFile(
    path.join(root, ".claude/agents/tech-lead.md"),
    `---\nname: tech-lead\n${toolsYaml}\n${skillsYaml}\n${modelYaml}\n---\n${refs}\n`,
  );
  await writeFile(
    path.join(root, ".claude/agents/worker.md"),
    "---\nname: worker\n---\n",
  );
  await writeFile(
    path.join(root, ".claude/skills/known/SKILL.md"),
    "# Known\n",
  );
  await writeFile(
    path.join(root, ".claude/skills/build/SKILL.md"),
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
  test("accepts Agent allowlists, model ids and fenced examples", async () => {
    const result = check(await fixture());
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain(
      "2 agent refs, 1 model refs, 1 skill refs, 1 command refs, 1 file refs",
    );
  });

  test("ignores invalid references in local state outside owned markdown roots", async () => {
    const root = await fixture();
    for (const area of [
      "worktrees/old/.claude/agents",
      "vendor/copied",
      "local-state",
    ]) {
      const dir = path.join(root, ".claude", area);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "stale.md"), "file:`missing.md`\n");
    }
    const result = check(root);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  });

  test("checks new markdown inputs in every owned root without a Git inventory", async () => {
    for (const [relative, source] of [
      [
        "agents/new-worker.md",
        "---\nname: new-worker\n---\nfile:`missing.md`\n",
      ],
      ["skills/known/new-guide.md", "file:`missing.md`\n"],
      ["references/new-guide.md", "file:`missing.md`\n"],
    ]) {
      const root = await fixture();
      const file = path.join(root, ".claude", relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, source);
      const result = check(root);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(
        `.claude/${relative}: missing file missing.md`,
      );
    }
  });

  test("accepts the registered reviewer's read-only capabilities", async () => {
    for (const tools of ["Read, Grep, Glob, Skill", "Read"]) {
      const root = await fixture();
      await writeFile(
        path.join(root, ".claude/agents/code-reviewer.md"),
        `---\nname: code-reviewer\ntools: ${tools}\n---\n`,
      );
      const result = check(root);
      expect(result.exitCode, result.stderr.toString()).toBe(0);
    }
  });

  test("rejects mutating reviewer capabilities by registered file identity", async () => {
    for (const tool of ["Bash", "Write", "Edit", "Agent(worker)"]) {
      for (const name of ["code-reviewer", "renamed-reviewer"]) {
        const root = await fixture();
        await writeFile(
          path.join(root, ".claude/agents/code-reviewer.md"),
          `---\nname: ${name}\ntools: Read, Grep, Glob, Skill, ${tool}\n---\n`,
        );
        const result = check(root);
        expect(result.exitCode).toBe(1);
        expect(result.stderr.toString()).toContain(
          "code-reviewer tools must be limited to Read, Grep, Glob, Skill",
        );
      }
    }
  });

  test("rejects a reviewer without an explicit nonempty read-only toolset", async () => {
    for (const toolsYaml of ["", 'tools: ""', 'tools: "  "']) {
      const root = await fixture();
      await writeFile(
        path.join(root, ".claude/agents/code-reviewer.md"),
        `---\nname: code-reviewer\n${toolsYaml}\n---\n`,
      );
      const result = check(root);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(
        "code-reviewer tools must be limited to Read, Grep, Glob, Skill",
      );
    }
  });

  test("rejects reviewer hooks even with read-only tools and a renamed identity", async () => {
    for (const name of ["code-reviewer", "renamed-reviewer"]) {
      for (const hooksYaml of [
        "hooks: {}",
        "hooks:\n  PreToolUse:\n    - matcher: Read\n      hooks:\n        - type: command\n          command: echo reviewer-hook",
      ]) {
        const root = await fixture();
        await writeFile(
          path.join(root, ".claude/agents/code-reviewer.md"),
          `---\nname: ${name}\ntools: Read, Grep, Glob, Skill\n${hooksYaml}\n---\n`,
        );
        const result = check(root);
        expect(result.exitCode).toBe(1);
        expect(result.stderr.toString()).toContain(
          "code-reviewer must not declare hooks",
        );
      }
    }
  });

  test("accepts a full claude model id and no model", async () => {
    const full = check(await fixture({ modelYaml: "model: claude-opus-5-5" }));
    expect(full.exitCode, full.stderr.toString()).toBe(0);
    const none = check(await fixture({ modelYaml: "" }));
    expect(none.exitCode, none.stderr.toString()).toBe(0);
  });

  test("rejects unknown and legacy references", async () => {
    const root = await fixture({
      toolsYaml: "tools: Agent(missing-agent)",
      modelYaml: "model: gpt-6",
      refs: "agent:`missing-agent` skill:`missing-skill` command:`/missing-command` file:`missing.md` use `legacy-skill` skills see `known` follow `other.md` `/file` `/optional`",
    });
    const result = check(root);
    const error = result.stderr.toString();
    expect(result.exitCode).toBe(1);
    expect(error).toContain("model must be opus, sonnet, haiku");
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
      toolsYaml: "tools: Agent(../worker)",
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
    await rm(path.join(root, ".claude/skills/known/SKILL.md"));
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing skill known");
  });

  test("rejects missing preload skills", async () => {
    const root = await fixture({ skillsYaml: "skills: [missing]" });
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing preload skill missing");
  });

  test("keeps worker agents and leaf skills free of skill and agent references", async () => {
    const workerRef = await fixture();
    await writeFile(
      path.join(workerRef, ".claude/agents/worker.md"),
      "---\nname: worker\n---\nskill:`known`\n",
    );
    const workerPreload = await fixture();
    await writeFile(
      path.join(workerPreload, ".claude/agents/worker.md"),
      "---\nname: worker\nskills: [known]\n---\n",
    );
    const leafSkill = await fixture();
    await writeFile(
      path.join(leafSkill, ".claude/skills/known/SKILL.md"),
      "# Known\nagent:`worker`\n",
    );
    const cases = [
      [workerRef, "worker agents do not reference skills"],
      [workerPreload, "worker agents do not preload skills"],
      [leafSkill, "leaf skills do not reference agents or skills"],
    ];
    for (const [root, message] of cases) {
      const result = check(root);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(message);
    }
  });

  test("lets commands and the lead wire agents and skills together", async () => {
    const root = await fixture({ skillsYaml: "skills: [known]" });
    await writeFile(
      path.join(root, ".claude/skills/build/SKILL.md"),
      '---\ndescription: build\nargument-hint: "<x>"\n---\nagent:`worker` skill:`known`\n',
    );
    const result = check(root);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  });

  test("rejects unsupported frontmatter keys", async () => {
    const root = await fixture({
      toolsYaml: "spawns: [worker]\nsandbox: read-only",
    });
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unsupported key spawns");
    expect(result.stderr.toString()).toContain("unsupported key sandbox");
  });

  test("rejects symlinked agent inventory entries", async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), "agent-config-agent-"));
    roots.push(outside);
    const target = path.join(outside, "worker.md");
    await writeFile(target, "---\nname: worker\n---\n");
    const worker = path.join(root, ".claude/agents/worker.md");
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
      "---\nname: lead\ntools: Agent(worker)\nmodel: opus\n---\n",
    );
    await writeFile(
      path.join(outside, "worker.md"),
      "---\nname: worker\n---\n",
    );
    const agents = path.join(root, ".claude/agents");
    await rm(agents, { recursive: true });
    await symlink(outside, agents);
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      ".claude/agents: markdown directory escapes repository",
    );
  });

  test("rejects a canonical skill symlink that escapes the repository", async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), "agent-config-skill-"));
    roots.push(outside);
    const target = path.join(outside, "SKILL.md");
    await writeFile(target, "# External\n");
    const skill = path.join(root, ".claude/skills/known/SKILL.md");
    await rm(skill);
    await symlink(target, skill);
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing skill known");
  });

  test("rejects a symlinked owned references directory", async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), "agent-config-refs-"));
    roots.push(outside);
    await writeFile(path.join(outside, "guide.md"), "# External\n");
    await symlink(outside, path.join(root, ".claude/references"));
    const result = check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      ".claude/references: markdown directory escapes repository",
    );
  });

  test("rejects malformed frontmatter shapes", async () => {
    const result = check(
      await fixture({
        toolsYaml: "tools: [Read]",
        skillsYaml: "skills: worker",
        modelYaml: "model:\n  nested: value",
      }),
    );
    const error = result.stderr.toString();
    expect(result.exitCode).toBe(1);
    expect(error).toContain("tools must be a comma-separated string");
    expect(error).toContain("skills must be a string list");
    expect(error).toContain("model must be opus, sonnet, haiku");
  });
});
