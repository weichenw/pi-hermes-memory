import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { MemoryConfig } from "./types.js";
import {
  DEFAULT_MEMORY_CHAR_LIMIT,
  DEFAULT_USER_CHAR_LIMIT,
  DEFAULT_PROJECT_CHAR_LIMIT,
  DEFAULT_NUDGE_INTERVAL,
  DEFAULT_FLUSH_MIN_TURNS,
  DEFAULT_NUDGE_TOOL_CALLS,
  DEFAULT_FAILURE_INJECTION_MAX_AGE_DAYS,
  DEFAULT_FAILURE_INJECTION_MAX_ENTRIES,
  DEFAULT_MEMORY_INJECT_LIMIT,
  DEFAULT_MEMORY_DOMAINS,
  DEFAULT_MEMORY_DOMAIN_KEYWORDS,
  DEFAULT_CONSOLIDATION_TIMEOUT_MS,
  DEFAULT_SESSION_RETENTION_DAYS,
  DEFAULT_MEMORY_RETENTION_DAYS,
} from "./constants.js";

import { normalizeConfiguredMemoryDir } from "./paths.js";

const DEFAULT_CONFIG: MemoryConfig = {
  memoryCharLimit: DEFAULT_MEMORY_CHAR_LIMIT,
  userCharLimit: DEFAULT_USER_CHAR_LIMIT,
  projectCharLimit: DEFAULT_PROJECT_CHAR_LIMIT,
  nudgeInterval: DEFAULT_NUDGE_INTERVAL,
  reviewEnabled: true,
  flushOnCompact: true,
  flushOnShutdown: true,
  flushMinTurns: DEFAULT_FLUSH_MIN_TURNS,
  autoConsolidate: true,
  correctionDetection: true,
  failureInjectionEnabled: true,
  failureInjectionMaxAgeDays: DEFAULT_FAILURE_INJECTION_MAX_AGE_DAYS,
  failureInjectionMaxEntries: DEFAULT_FAILURE_INJECTION_MAX_ENTRIES,
  nudgeToolCalls: DEFAULT_NUDGE_TOOL_CALLS,
  autoInject: true,
  memoryInjectLimit: DEFAULT_MEMORY_INJECT_LIMIT,
  memoryDomains: DEFAULT_MEMORY_DOMAINS,
  memoryDomainKeywords: { ...DEFAULT_MEMORY_DOMAIN_KEYWORDS },
  consolidationTimeoutMs: DEFAULT_CONSOLIDATION_TIMEOUT_MS,
  sessionRetentionDays: DEFAULT_SESSION_RETENTION_DAYS,
  memoryRetentionDays: DEFAULT_MEMORY_RETENTION_DAYS,
};

export const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "hermes-memory-config.json",
);

export const SETTINGS_CONFIG_PATH = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "settings.json",
);

function mergeConfig(base: MemoryConfig, parsed: Record<string, unknown>): MemoryConfig {
  const config: MemoryConfig = { ...base };
  if (typeof parsed.memoryCharLimit === "number") config.memoryCharLimit = parsed.memoryCharLimit;
  if (typeof parsed.userCharLimit === "number") config.userCharLimit = parsed.userCharLimit;
  if (typeof parsed.nudgeInterval === "number") config.nudgeInterval = parsed.nudgeInterval;
  if (typeof parsed.reviewEnabled === "boolean") config.reviewEnabled = parsed.reviewEnabled;
  if (typeof parsed.flushOnCompact === "boolean") config.flushOnCompact = parsed.flushOnCompact;
  if (typeof parsed.flushOnShutdown === "boolean") config.flushOnShutdown = parsed.flushOnShutdown;
  if (typeof parsed.flushMinTurns === "number") config.flushMinTurns = parsed.flushMinTurns;
  if (typeof parsed.autoConsolidate === "boolean") config.autoConsolidate = parsed.autoConsolidate;
  if (typeof parsed.correctionDetection === "boolean") config.correctionDetection = parsed.correctionDetection;
  if (typeof parsed.failureInjectionEnabled === "boolean") config.failureInjectionEnabled = parsed.failureInjectionEnabled;
  if (typeof parsed.failureInjectionMaxAgeDays === "number") config.failureInjectionMaxAgeDays = parsed.failureInjectionMaxAgeDays;
  if (typeof parsed.failureInjectionMaxEntries === "number") config.failureInjectionMaxEntries = parsed.failureInjectionMaxEntries;
  if (typeof parsed.nudgeToolCalls === "number") config.nudgeToolCalls = parsed.nudgeToolCalls;
  if (typeof parsed.projectCharLimit === "number") config.projectCharLimit = parsed.projectCharLimit;
  if (typeof parsed.consolidationTimeoutMs === "number") config.consolidationTimeoutMs = parsed.consolidationTimeoutMs;
  if (typeof parsed.sessionRetentionDays === "number") config.sessionRetentionDays = parsed.sessionRetentionDays;
  if (typeof parsed.memoryRetentionDays === "number") config.memoryRetentionDays = parsed.memoryRetentionDays;
  if (typeof parsed.memoryDir === "string") {
    const normalizedMemoryDir = normalizeConfiguredMemoryDir(parsed.memoryDir);
    if (normalizedMemoryDir) config.memoryDir = normalizedMemoryDir;
  }
  if (typeof parsed.autoInject === "boolean") config.autoInject = parsed.autoInject;
  if (typeof parsed.memoryInjectLimit === "number") config.memoryInjectLimit = parsed.memoryInjectLimit;
  if (Array.isArray(parsed.memoryDomains)) config.memoryDomains = parsed.memoryDomains as string[];
  if (parsed.memoryDomainKeywords && typeof parsed.memoryDomainKeywords === "object") {
    // Merge user keywords over defaults (user can override per-domain or add new domains)
    const userMap = parsed.memoryDomainKeywords as Record<string, unknown>;
    const merged: Record<string, string[]> = { ...config.memoryDomainKeywords };
    for (const [key, val] of Object.entries(userMap)) {
      if (Array.isArray(val) && val.every((v) => typeof v === "string")) {
        merged[key] = val as string[];
      }
    }
    config.memoryDomainKeywords = merged;
  }
  return config;
}

export function loadConfig(): MemoryConfig {
  let config: MemoryConfig = { ...DEFAULT_CONFIG };

  // 1. Try .pi/agent/settings.json (highest priority)
  try {
    if (fs.existsSync(SETTINGS_CONFIG_PATH)) {
      const raw = fs.readFileSync(SETTINGS_CONFIG_PATH, "utf-8");
      const settings = JSON.parse(raw) as Record<string, unknown>;
      if (settings.hermesMemory && typeof settings.hermesMemory === "object") {
        config = mergeConfig(config, settings.hermesMemory as Record<string, unknown>);
      }
    }
  } catch {
    // Ignore parse errors
  }

  // 2. Fallback / override via dedicated config file
  try {
    if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
      const raw = fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      config = mergeConfig(config, parsed);
    }
  } catch {
    // Fall back to current merged config
  }

  return config;
}
