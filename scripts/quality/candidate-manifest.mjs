import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";

const decoder = new TextDecoder("utf-8", { fatal: true });

function git(args, cwd, allowFailure = false) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = decoder.decode(result.stdout);
  if (!allowFailure && result.exitCode !== 0) {
    throw new Error(
      decoder.decode(result.stderr).trim() || `git ${args.join(" ")} failed`,
    );
  }
  return { code: result.exitCode, out };
}

function optionValue(args, index, flag) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

const args = process.argv.slice(2);
let base = "HEAD";
let fromFile;
let positional = false;
const requested = [];
const exclusions = new Map();
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (positional) {
    requested.push(arg);
  } else if (arg === "--") {
    positional = true;
  } else if (arg === "--base") {
    base = optionValue(args, index, arg);
    index += 1;
  } else if (arg === "--from") {
    fromFile = optionValue(args, index, arg);
    index += 1;
  } else if (arg === "--exclude") {
    const value = optionValue(args, index, arg);
    index += 1;
    const separator = value.indexOf("=");
    if (separator < 1 || !value.slice(separator + 1).trim()) {
      throw new Error("--exclude requires path=reason");
    }
    exclusions.set(
      value.slice(0, separator),
      value.slice(separator + 1).trim(),
    );
  } else if (arg.startsWith("--")) {
    throw new Error(`unknown option: ${arg}`);
  } else {
    requested.push(arg);
  }
}

const root = git(["rev-parse", "--show-toplevel"], process.cwd()).out.trim();
const normalize = (input) => {
  if (/[\x00-\x1f\x7f]/.test(input)) {
    throw new Error(`candidate path contains a forbidden control character`);
  }
  const absolute = path.resolve(root, input);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`path escapes repository: ${input}`);
  }
  return relative;
};

const comparePaths = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0;
if (fromFile) {
  requested.push(
    ...(await readFile(path.resolve(fromFile), "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

const baseCommit = git(
  ["rev-parse", "--verify", `${base}^{commit}`],
  root,
).out.trim();
const stagedPaths = git(
  ["diff", "--cached", "--no-renames", "--name-only", "-z", baseCommit],
  root,
)
  .out.split("\0")
  .filter(Boolean)
  .map(normalize);
for (const stagedPath of stagedPaths) {
  const comparison = git(["diff", "--quiet", "--", stagedPath], root, true);
  if (comparison.code === 1) {
    throw new Error(
      `index differs from worktree for staged path: ${stagedPath}`,
    );
  }
  if (comparison.code !== 0) {
    throw new Error(`cannot compare index and worktree for: ${stagedPath}`);
  }
}
const discovered = new Set(
  [
    ...git(["diff", "--no-renames", "--name-only", "-z", baseCommit], root)
      .out.split("\0")
      .filter(Boolean),
    ...git(["ls-files", "--others", "--exclude-standard", "-z"], root)
      .out.split("\0")
      .filter(Boolean),
  ].map(normalize),
);
if (!discovered.size)
  throw new Error("no tracked or untracked candidate changes found");

const normalizedExclusions = new Map(
  [...exclusions].map(([file, reason]) => [normalize(file), reason]),
);
for (const file of normalizedExclusions.keys()) {
  if (!discovered.has(file))
    throw new Error(`excluded path is not a candidate change: ${file}`);
}

const explicitScope = requested.length > 0;
const included = new Set(
  (explicitScope ? requested.map(normalize) : [...discovered]).filter(
    (file) => !normalizedExclusions.has(file),
  ),
);
if (explicitScope) {
  const omitted = [...discovered].filter(
    (file) => !included.has(file) && !normalizedExclusions.has(file),
  );
  if (omitted.length)
    throw new Error(
      `candidate scope omits discovered paths: ${omitted.sort(comparePaths).join(", ")}`,
    );
  const unknown = [...included].filter((file) => !discovered.has(file));
  if (unknown.length)
    throw new Error(
      `candidate scope contains unchanged paths: ${unknown.sort(comparePaths).join(", ")}`,
    );
}
if (!included.size)
  throw new Error("candidate scope is empty after exclusions");

const files = [];
for (const relative of [...included].sort(comparePaths)) {
  const absolute = path.join(root, relative);
  const baseExists =
    git(["cat-file", "-e", `${baseCommit}:${relative}`], root, true).code === 0;
  let stat;
  try {
    stat = await lstat(absolute);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const worktreeExists = stat !== undefined;
  let state;
  if (!worktreeExists) state = "deleted";
  else if (!baseExists) {
    state =
      git(["ls-files", "--error-unmatch", "--", relative], root, true).code ===
      0
        ? "added"
        : "untracked";
  } else state = "modified";

  if (!worktreeExists) {
    files.push({
      path: relative,
      state,
      kind: "file",
      mode: null,
      sha256: null,
    });
    continue;
  }
  if (!stat.isFile() && !stat.isSymbolicLink())
    throw new Error(`candidate path is not a file: ${relative}`);
  const kind = stat.isSymbolicLink() ? "symlink" : "file";
  const content =
    kind === "symlink"
      ? await readlink(absolute, { encoding: "buffer" })
      : await readFile(absolute);
  files.push({
    path: relative,
    state,
    kind,
    mode: (stat.mode & 0o777).toString(8).padStart(3, "0"),
    sha256: createHash("sha256").update(content).digest("hex"),
  });
}

const nonCandidateExclusions = [...normalizedExclusions]
  .sort(([left], [right]) => comparePaths(left, right))
  .map(([file, reason]) => ({ path: file, reason }));
const payload = { version: 1, baseCommit, files, nonCandidateExclusions };
const manifestSha256 = createHash("sha256")
  .update(JSON.stringify(payload))
  .digest("hex");
console.log(JSON.stringify({ ...payload, manifestSha256 }, null, 2));
