import * as os from "node:os";
import * as path from "node:path";

export const AGENT_ROOT = path.join(os.homedir(), ".pi", "agent");

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function normalizeConfiguredMemoryDir(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const expanded = expandHome(trimmed);
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return path.resolve(AGENT_ROOT, expanded);
}
