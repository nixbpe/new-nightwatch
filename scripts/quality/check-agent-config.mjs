import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const rootFlag = process.argv.indexOf("--root");
const root =
  rootFlag >= 0 ? path.resolve(process.argv[rootFlag + 1]) : defaultRoot;
const canonicalRoot = await realpath(root);
const claude = path.join(root, ".claude");
const errors = [];
const modelPattern = /^(opus|sonnet|haiku|inherit|claude-[a-z0-9.-]+)$/;
const legacyKeys = ["spawns", "autoloadSkills", "sandbox", "blocking"];
const referenceNamePattern = /^[a-z][a-z0-9-]*$/;

function isContained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function resolvesInside(parent, candidate) {
  try {
    const resolved = await realpath(candidate);
    return isContained(parent, resolved) && (await lstat(resolved)).isFile();
  } catch {
    return false;
  }
}
async function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  const resolved = await realpath(dir);
  if (
    !isContained(canonicalRoot, resolved) ||
    (await lstat(dir)).isSymbolicLink()
  ) {
    errors.push(
      `${path.relative(root, dir)}: markdown directory escapes repository`,
    );
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(dir, entry.name);
      return entry.isDirectory()
        ? markdownFiles(target)
        : entry.isFile() && entry.name.endsWith(".md")
          ? [target]
          : [];
    }),
  );
  return nested.flat();
}

function stripFencedCode(source) {
  const output = [];
  let fence;
  for (const line of source.split("\n")) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (!fence && marker) {
      fence = { char: marker[1][0], length: marker[1].length };
      output.push("");
    } else if (
      fence &&
      marker &&
      marker[1][0] === fence.char &&
      marker[1].length >= fence.length
    ) {
      fence = undefined;
      output.push("");
    } else {
      output.push(fence ? "" : line);
    }
  }
  return output.join("\n");
}

const counts = { agents: 0, models: 0, skills: 0, commands: 0, files: 0 };
const agentDir = path.join(claude, "agents");
const agentFiles = await markdownFiles(agentDir);
const agentNames = new Set(
  agentFiles.map((file) => path.basename(file, ".md")),
);
const preloadDeclarations = [];
for (const file of agentFiles) {
  const source = await readFile(file, "utf8");
  const frontmatterSource = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (frontmatterSource === undefined) {
    errors.push(`${path.relative(root, file)}: missing frontmatter`);
    continue;
  }
  let frontmatter;
  try {
    frontmatter = Bun.YAML.parse(frontmatterSource) ?? {};
  } catch (error) {
    errors.push(
      `${path.relative(root, file)}: malformed frontmatter: ${error.message}`,
    );
    continue;
  }
  if (
    !frontmatter ||
    typeof frontmatter !== "object" ||
    Array.isArray(frontmatter)
  ) {
    errors.push(`${path.relative(root, file)}: frontmatter must be a mapping`);
    continue;
  }
  const agent = frontmatter.name ?? path.basename(file, ".md");
  for (const key of legacyKeys) {
    if (key in frontmatter) {
      errors.push(`${path.relative(root, file)}: unsupported key ${key}`);
    }
  }
  const tools = frontmatter.tools ?? "";
  if (typeof tools !== "string") {
    errors.push(
      `${path.relative(root, file)}: tools must be a comma-separated string`,
    );
  } else {
    for (const allowlist of tools.matchAll(/Agent\(([^)]*)\)/g)) {
      for (const spawn of allowlist[1].split(",").map((name) => name.trim())) {
        counts.agents += 1;
        if (!referenceNamePattern.test(spawn)) {
          errors.push(
            `${path.relative(root, file)}: invalid agent identity ${spawn}`,
          );
        } else if (!agentNames.has(spawn)) {
          errors.push(
            `${path.relative(root, file)}: ${agent} spawns missing agent ${spawn}`,
          );
        }
      }
    }
  }
  const preloadSkills = frontmatter.skills ?? [];
  if (
    !Array.isArray(preloadSkills) ||
    preloadSkills.some((skill) => typeof skill !== "string")
  ) {
    errors.push(`${path.relative(root, file)}: skills must be a string list`);
  } else {
    preloadDeclarations.push({ file, skills: preloadSkills });
  }
  if (frontmatter.model !== undefined) {
    counts.models += 1;
    if (
      typeof frontmatter.model !== "string" ||
      !modelPattern.test(frontmatter.model)
    ) {
      errors.push(
        `${path.relative(root, file)}: model must be opus, sonnet, haiku, inherit or a claude-* id`,
      );
    }
  }
}

const skillNames = new Set();
for (const entry of await readdir(path.join(claude, "skills"), {
  withFileTypes: true,
})) {
  if (
    entry.isDirectory() &&
    (await resolvesInside(
      canonicalRoot,
      path.join(claude, "skills", entry.name, "SKILL.md"),
    ))
  ) {
    skillNames.add(entry.name);
  }
}
for (const declaration of preloadDeclarations) {
  for (const skill of declaration.skills) {
    counts.skills += 1;
    if (!referenceNamePattern.test(skill) || !skillNames.has(skill)) {
      errors.push(
        `${path.relative(root, declaration.file)}: missing preload skill ${skill}`,
      );
    }
  }
}
for (const file of await markdownFiles(claude)) {
  const source = stripFencedCode(await readFile(file, "utf8"));
  for (const match of source.matchAll(/agent:`([^`]+)`/g)) {
    counts.agents += 1;
    if (!referenceNamePattern.test(match[1])) {
      errors.push(
        `${path.relative(root, file)}: invalid agent reference ${match[1]}`,
      );
    } else if (!agentNames.has(match[1])) {
      errors.push(`${path.relative(root, file)}: missing agent ${match[1]}`);
    }
  }
  for (const match of source.matchAll(/`([a-z][a-z0-9-]*)`/g)) {
    if (
      agentNames.has(match[1]) &&
      source.slice(Math.max(0, match.index - 6), match.index) !== "agent:"
    ) {
      errors.push(
        `${path.relative(root, file)}: legacy agent reference ${match[1]}; use agent:\`${match[1]}\``,
      );
    }
  }
  for (const match of source.matchAll(
    /\b(?:(?:use|follow|invoke|alongside|see)\s+(?:the\s+)?|the\s+)`([a-z][a-z0-9-]+)`(?:'s)?(?:\s+skills?)?/gi,
  )) {
    if (skillNames.has(match[1]) || /\s+skills?$/i.test(match[0])) {
      errors.push(
        `${path.relative(root, file)}: legacy skill reference ${match[1]}; use skill:\`${match[1]}\``,
      );
    }
  }
  for (const match of source.matchAll(/skill:`([^`]+)`/g)) {
    counts.skills += 1;
    if (!referenceNamePattern.test(match[1]) || !skillNames.has(match[1])) {
      errors.push(`${path.relative(root, file)}: missing skill ${match[1]}`);
    }
  }
  for (const match of source.matchAll(/command:`\/([^`]+)`/g)) {
    counts.commands += 1;
    if (!referenceNamePattern.test(match[1]) || !skillNames.has(match[1])) {
      errors.push(`${path.relative(root, file)}: missing command /${match[1]}`);
    }
  }
  for (const match of source.matchAll(/file:`([^`]+)`/g)) {
    counts.files += 1;
    const candidates = [
      path.resolve(root, match[1]),
      path.resolve(path.dirname(file), match[1]),
    ];
    let found = false;
    for (const candidate of candidates) {
      if (await resolvesInside(canonicalRoot, candidate)) {
        found = true;
        break;
      }
    }
    if (!found)
      errors.push(`${path.relative(root, file)}: missing file ${match[1]}`);
  }
  for (const match of source.matchAll(
    /\b(?:read|follow|use|see|from)\s+`([^`\n*?{}]+\.md)`/gi,
  )) {
    errors.push(
      `${path.relative(root, file)}: legacy file reference ${match[1]}; use file:\`${match[1]}\``,
    );
  }
}

if (errors.length) {
  console.error(errors.sort().join("\n"));
  process.exit(1);
}
console.log(
  `agent config ok: ${counts.agents} agent refs, ${counts.models} model refs, ` +
    `${counts.skills} skill refs, ${counts.commands} command refs, ${counts.files} file refs`,
);
