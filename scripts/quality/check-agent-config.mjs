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
const omp = path.join(root, ".omp");
const errors = [];
const allowedEfforts = new Set(["low", "medium", "high"]);
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
async function isContainedRegularFileWithoutSymlinks(
  lexicalParent,
  canonicalParent,
  candidate,
) {
  try {
    const relative = path.relative(lexicalParent, candidate);
    if (
      relative === "" ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return false;
    }
    const components = relative.split(path.sep);
    let current = lexicalParent;
    for (const [index, component] of components.entries()) {
      current = path.join(current, component);
      const entry = await lstat(current);
      if (
        entry.isSymbolicLink() ||
        (index === components.length - 1
          ? !entry.isFile()
          : !entry.isDirectory())
      ) {
        return false;
      }
    }
    const resolved = await realpath(candidate);
    return isContained(canonicalParent, resolved);
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

async function readYaml(file, label) {
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch {
    errors.push(`${path.relative(root, file)}: missing ${label}`);
    return {};
  }
  try {
    const parsed = Bun.YAML.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("expected a mapping");
    }
    return parsed;
  } catch (error) {
    errors.push(
      `${path.relative(root, file)}: malformed ${label}: ${error.message}`,
    );
    return {};
  }
}

const configPath = path.join(omp, "config.yml");
let config;
if (
  existsSync(configPath) &&
  !(await isContainedRegularFileWithoutSymlinks(
    root,
    canonicalRoot,
    configPath,
  ))
) {
  errors.push(
    `${path.relative(root, configPath)}: config must be an in-repository regular file`,
  );
  config = {};
} else {
  config = await readYaml(configPath, "config.yml");
}
const modelRoles = config.modelRoles;
const roles = new Set();
if (
  !modelRoles ||
  typeof modelRoles !== "object" ||
  Array.isArray(modelRoles)
) {
  errors.push(
    `${path.relative(root, configPath)}: modelRoles must be a mapping`,
  );
} else {
  for (const [role, selector] of Object.entries(modelRoles)) {
    roles.add(role);
    if (typeof selector !== "string") {
      errors.push(
        `${path.relative(root, configPath)}: model role ${role} must be a selector string`,
      );
      continue;
    }
    const suffixAt = selector.lastIndexOf(":");
    if (suffixAt > selector.lastIndexOf("/")) {
      const effort = selector.slice(suffixAt + 1);
      if (!allowedEfforts.has(effort)) {
        errors.push(
          `${path.relative(root, configPath)}: unknown effort ${JSON.stringify(effort)} for ${role}`,
        );
      }
    }
  }
}

const counts = { agents: 0, models: 0, skills: 0, commands: 0, files: 0 };
const agentDir = path.join(omp, "agents");
const agentFiles = await markdownFiles(agentDir);
const agentNames = new Set(
  agentFiles.map((file) => path.basename(file, ".md")),
);
const autoloadDeclarations = [];
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
  const spawns = frontmatter.spawns ?? [];
  if (
    !Array.isArray(spawns) ||
    spawns.some((spawn) => typeof spawn !== "string")
  ) {
    errors.push(`${path.relative(root, file)}: spawns must be a string list`);
  } else {
    for (const spawn of spawns) {
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
  const autoloadSkills = frontmatter.autoloadSkills ?? [];
  if (
    !Array.isArray(autoloadSkills) ||
    autoloadSkills.some((skill) => typeof skill !== "string")
  ) {
    errors.push(
      `${path.relative(root, file)}: autoloadSkills must be a string list`,
    );
  } else {
    autoloadDeclarations.push({ file, skills: autoloadSkills });
  }
  const model = frontmatter.model ?? [];
  const selectors = typeof model === "string" ? [model] : model;
  if (
    !Array.isArray(selectors) ||
    selectors.some((selector) => typeof selector !== "string")
  ) {
    errors.push(
      `${path.relative(root, file)}: model must be a string or string list`,
    );
  } else {
    for (const selector of selectors) {
      for (const alias of selector.matchAll(/@([\w-]+)/g)) {
        counts.models += 1;
        if (alias[1] !== "default" && !roles.has(alias[1])) {
          errors.push(
            `${path.relative(root, file)}: missing model role @${alias[1]}`,
          );
        }
      }
    }
  }
}

const skillNames = new Set();
for (const entry of await readdir(path.join(omp, "skills"), {
  withFileTypes: true,
})) {
  if (
    entry.isDirectory() &&
    (await resolvesInside(
      canonicalRoot,
      path.join(omp, "skills", entry.name, "SKILL.md"),
    ))
  ) {
    skillNames.add(entry.name);
  }
}
for (const declaration of autoloadDeclarations) {
  for (const skill of declaration.skills) {
    counts.skills += 1;
    if (!referenceNamePattern.test(skill) || !skillNames.has(skill)) {
      errors.push(
        `${path.relative(root, declaration.file)}: missing autoload skill ${skill}`,
      );
    }
  }
}
const commandDir = path.join(omp, "commands");
const commandNames = new Set(
  (await markdownFiles(commandDir))
    .filter((file) => path.dirname(file) === commandDir)
    .map((file) => path.basename(file, ".md")),
);

for (const file of await markdownFiles(omp)) {
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
    if (!referenceNamePattern.test(match[1]) || !commandNames.has(match[1])) {
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

const expectedCounts = config.referenceInventory;
if (
  !expectedCounts ||
  typeof expectedCounts !== "object" ||
  Array.isArray(expectedCounts)
) {
  errors.push(
    `${path.relative(root, configPath)}: referenceInventory must be a mapping`,
  );
} else {
  for (const [kind, actual] of Object.entries(counts)) {
    if (expectedCounts[kind] !== actual) {
      errors.push(
        `${path.relative(root, configPath)}: ${kind} reference count ${actual} does not match inventory ${expectedCounts[kind]}`,
      );
    }
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
