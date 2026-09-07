#!/usr/bin/env bun
/**
 * Generate Claude Code and Codex subagent definitions from the canonical
 * `.omp/agents/*.md` sources (Oh My Pi format).
 *
 *   bun scripts/sync-agents.mjs          write .claude/agents/*.md and .codex/agents/*.toml
 *   bun scripts/sync-agents.mjs --check  exit 1 when a generated file is missing or stale
 *
 * Why generate: omp skips `.claude/agents` and `.codex/agents`, Claude Code reads
 * only `.claude/agents/*.md`, and Codex reads only `.codex/agents/*.toml`.
 *
 * Field mapping (frontmatter -> target):
 *   name, description  -> same in both targets
 *   tools              -> Claude Code PascalCase tool names; omp-only tools (eval, lsp, ...) are dropped
 *                      -> Codex sandbox_mode: read-only unless a mutating tool is listed
 *   autoloadSkills     -> Claude Code `skills` (preload); Codex has no per-agent skill preload
 *   body               -> Claude Code system prompt / Codex developer_instructions, unchanged
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_DIR = join(ROOT, ".omp", "agents");
const CHECK = process.argv.includes("--check");

const CLAUDE_TOOL_NAMES = {
  read: "Read",
  grep: "Grep",
  glob: "Glob",
  edit: "Edit",
  write: "Write",
  bash: "Bash",
  web_search: "WebSearch",
  task: "Agent",
  notebook: "NotebookEdit",
};
const MUTATING_TOOLS = new Set([
  "edit",
  "write",
  "bash",
  "eval",
  "ast_edit",
  "notebook",
  "python",
]);

const TARGETS = [
  {
    label: "Claude Code",
    dir: join(ROOT, ".claude", "agents"),
    ext: ".md",
    render: renderClaude,
  },
  {
    label: "Codex",
    dir: join(ROOT, ".codex", "agents"),
    ext: ".toml",
    render: renderCodex,
  },
];

function asList(value) {
  if (Array.isArray(value))
    return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string")
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  return [];
}

function parseAgent(text, file) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: frontmatter block not found`);
  const frontmatter = Bun.YAML.parse(match[1]) ?? {};
  const { name, description } = frontmatter;
  if (typeof name !== "string" || !name.trim())
    throw new Error(`${file}: frontmatter needs a string "name"`);
  if (typeof description !== "string" || !description.trim()) {
    throw new Error(`${file}: frontmatter needs a string "description"`);
  }
  return {
    file,
    name: name.trim(),
    description: description.trim(),
    tools: asList(frontmatter.tools),
    skills: asList(frontmatter.autoloadSkills),
    body: `${match[2].trim()}\n`,
  };
}

function header(agent) {
  const source = relative(ROOT, agent.file);
  return `Generated from ${source} by scripts/sync-agents.mjs. Edit the source, then run: bun run agents:sync`;
}

function renderClaude(agent) {
  const tools = agent.tools
    .map((tool) => CLAUDE_TOOL_NAMES[tool])
    .filter(Boolean);
  const dropped = agent.tools.filter((tool) => !CLAUDE_TOOL_NAMES[tool]);
  const lines = [
    "---",
    `# ${header(agent)}`,
    `name: ${agent.name}`,
    `description: ${JSON.stringify(agent.description)}`,
  ];
  if (tools.length) lines.push(`tools: ${tools.join(", ")}`);
  if (agent.skills.length) lines.push(`skills: [${agent.skills.join(", ")}]`);
  lines.push("---", "", agent.body);
  const notes = dropped.length
    ? [
        `omp-only tools have no Claude Code equivalent and were dropped: ${dropped.join(", ")}`,
      ]
    : [];
  return { text: lines.join("\n"), notes };
}

function renderCodex(agent) {
  if (agent.body.includes("'''")) {
    throw new Error(
      `${agent.file}: body contains ''' and cannot be embedded in a TOML literal string`,
    );
  }
  const sandbox = agent.tools.some((tool) => MUTATING_TOOLS.has(tool))
    ? "workspace-write"
    : "read-only";
  const text = [
    `# ${header(agent)}`,
    `name = ${JSON.stringify(agent.name)}`,
    `description = ${JSON.stringify(agent.description)}`,
    `sandbox_mode = "${sandbox}"`,
    "developer_instructions = '''",
    `${agent.body}'''`,
    "",
  ].join("\n");
  return { text, notes: [] };
}

async function loadAgents() {
  const entries = (await readdir(SOURCE_DIR))
    .filter((entry) => entry.endsWith(".md"))
    .sort();
  const agents = [];
  const names = new Set();
  for (const entry of entries) {
    const file = join(SOURCE_DIR, entry);
    const agent = parseAgent(await readFile(file, "utf8"), file);
    if (names.has(agent.name))
      throw new Error(`${file}: duplicate agent name "${agent.name}"`);
    names.add(agent.name);
    agents.push(agent);
  }
  if (!agents.length) throw new Error(`${SOURCE_DIR}: no agent sources found`);
  return agents;
}

async function main() {
  const agents = await loadAgents();
  const names = new Set(agents.map((agent) => agent.name));
  const stale = [];
  let written = 0;

  for (const target of TARGETS) {
    if (!CHECK) await mkdir(target.dir, { recursive: true });
    for (const agent of agents) {
      const { text, notes } = target.render(agent);
      const out = join(target.dir, `${agent.name}${target.ext}`);
      const rel = relative(ROOT, out);
      for (const note of notes) console.warn(`${rel}: ${note}`);
      const current = await readFile(out, "utf8").catch(() => null);
      if (current === text) continue;
      if (CHECK) {
        stale.push(rel);
        continue;
      }
      await writeFile(out, text);
      written += 1;
      console.log(`wrote ${rel}`);
    }
    const existing = await readdir(target.dir).catch(() => []);
    for (const entry of existing) {
      if (
        entry.endsWith(target.ext) &&
        !names.has(basename(entry, target.ext))
      ) {
        console.warn(
          `${relative(ROOT, join(target.dir, entry))}: no matching source in .omp/agents; remove it by hand`,
        );
      }
    }
  }

  if (CHECK) {
    if (stale.length) {
      console.error(
        `stale or missing generated agents:\n  ${stale.join("\n  ")}\nrun: bun run agents:sync`,
      );
      process.exit(1);
    }
    console.log(
      `agents in sync: ${agents.length} sources, ${TARGETS.length} targets`,
    );
    return;
  }
  console.log(`${written} file(s) written for ${agents.length} agent(s)`);
}

await main();
