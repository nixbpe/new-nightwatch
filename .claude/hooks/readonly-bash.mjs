// PreToolUse guard for agent:`code-reviewer`: only read-only inspection commands may run.
const input = JSON.parse(await Bun.stdin.text());
const command = String(input.tool_input?.command ?? "");

const readOnlyTools = new Set([
  "ls", "cat", "head", "tail", "wc", "grep", "rg", "find", "sort", "uniq", "cut", "diff", "stat", "file", "pwd", "echo",
]);
const readOnlyGit = new Set([
  "diff", "log", "show", "status", "blame", "ls-files", "rev-parse", "cat-file", "merge-base", "shortlog",
]);
const readOnlyGh = new Set(["view", "diff", "checks", "list", "status"]);

function deny(reason) {
  console.error(`Blocked: ${reason}. code-reviewer may only run read-only inspection commands.`);
  process.exit(2);
}

if (/[;&<>`]|\$\(|\|\|/.test(command)) deny("shell operator not allowed");
for (const segment of command.split("|")) {
  const [tool, sub, ...rest] = segment.trim().split(/\s+/);
  if (tool === "git") {
    if (!readOnlyGit.has(sub)) deny(`git ${sub ?? ""}`);
  } else if (tool === "gh") {
    if (!["pr", "issue", "run"].includes(sub) || !readOnlyGh.has(rest[0])) deny(`gh ${sub ?? ""} ${rest[0] ?? ""}`);
  } else if (!readOnlyTools.has(tool)) {
    deny(tool || "empty command");
  } else if (tool === "find" && /-(exec|execdir|delete|fprint|fls|ok)\b/.test(segment)) {
    deny("find with an action");
  }
}
