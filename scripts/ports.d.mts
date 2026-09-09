export declare const repoRoot: string;

export interface WorktreePorts {
  slot: number;
  webPort: number;
  apiPort: number;
  dbPort: number;
  mailSmtpPort: number;
  mailUiPort: number;
}

export declare function worktreeSlot(rootDir?: string): number;

export declare function resolvePorts(
  env?: Record<string, string | undefined>,
): WorktreePorts;
