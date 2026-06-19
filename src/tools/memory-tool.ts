/**
 * Memory tool — registers the LLM-callable `memory` tool.
 * Ported from hermes-agent/tools/memory_tool.py (MEMORY_SCHEMA + memory_tool dispatch).
 * See PLAN.md → "Hermes Source File Reference Map" for source lines.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { MemoryStore } from "../store/memory-store.js";
import { DatabaseManager } from "../store/db.js";
import { addMemory } from "../store/sqlite-memory-store.js";
import { MEMORY_TOOL_DESCRIPTION } from "../constants.js";
import type { MemoryCategory, MemoryConfig } from "../types.js";
import { syncToCortex } from "../cortex-sync.js";

/**
 * Extract content-bearing keywords from text for domain matching.
 * Filters out common stop words and short tokens.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
    "during", "before", "after", "above", "below", "between", "under",
    "again", "further", "then", "once", "here", "there", "when", "where",
    "why", "how", "all", "any", "both", "each", "few", "more", "most",
    "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "so", "than", "too", "very", "just", "and", "but", "if", "or",
    "because", "until", "while",
  ]);
  return [...new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !stopWords.has(w)))];
}

/**
 * Infer the best-matching domain from content.
 * Uses the provided keyword map first; falls back to matching the domain name itself.
 * Returns the domain with the highest keyword overlap, or undefined if no match.
 */
function inferDomain(
  content: string,
  domains: string[],
  keywordMap: Record<string, string[]>,
): string | undefined {
  if (!domains.length) return undefined;
  const words = new Set(extractKeywords(content));
  let best: string | undefined;
  let bestScore = 0;

  for (const d of domains) {
    // Use configured keywords for this domain if available, else fall back to domain name words
    const keywords = keywordMap[d] ?? d.toLowerCase().split(/\W+/).filter((w) => w.length > 1);
    const score = keywords.reduce((sum, kw) => sum + (words.has(kw.toLowerCase()) ? 1 : 0), 0);
    // Normalize by keyword count so longer keyword lists don't automatically win
    const normalized = score / Math.max(1, keywords.length);
    if (normalized > bestScore) {
      bestScore = normalized;
      best = d;
    }
  }

  // Require at least one keyword match to assign a domain
  return bestScore > 0 ? best : undefined;
}

export function registerMemoryTool(
  pi: ExtensionAPI,
  store: MemoryStore,
  projectStore: MemoryStore | null,
  dbManager: DatabaseManager,
  projectName: string,
  memoryDomains: string[] = [],
  memoryDomainKeywords: Record<string, string[]> = {},
  config?: MemoryConfig,
): void {
  pi.registerTool({
    name: "memory",
    label: "Memory",
    description: MEMORY_TOOL_DESCRIPTION,
    promptSnippet:
      "Save or manage persistent memory that survives across sessions",
    promptGuidelines: [
      "Use the memory tool proactively when the user corrects you, shares a preference, or reveals personal details worth remembering.",
      "Use the memory tool when you discover environment facts, project conventions, or reusable patterns useful in future sessions.",
      "Do NOT use memory for temporary task state, TODO items, or session progress — only for durable, cross-session facts.",
      "Use target='failure' with category to save what didn't work (failures, corrections, insights).",
      "Domain tags are auto-inferred from content. Only set domain explicitly if the auto-detected tag would be wrong.",
    ],
    parameters: Type.Object({
      action: StringEnum(["add", "replace", "remove"] as const),
      target: StringEnum(["memory", "user", "project", "failure"] as const),
      content: Type.Optional(
        Type.String({ description: "Entry content for add/replace" })
      ),
      old_text: Type.Optional(
        Type.String({
          description:
            "Substring identifying entry for replace/remove",
        })
      ),
      category: Type.Optional(
        StringEnum(["failure", "correction", "insight", "preference", "convention", "tool-quirk"] as const, {
          description: "Category for failure memories",
        })
      ),
      failure_reason: Type.Optional(
        Type.String({ description: "Why it failed (for failure category)" })
      ),
      domain: Type.Optional(
        Type.String({ description: "Domain tag for this memory (e.g., finance, health, work). Auto-inferred from content if omitted." })
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { action, target: rawTarget, content, old_text, category, failure_reason, domain: explicitDomain } = params;

      // Auto-infer domain when not explicitly provided
      let domain = explicitDomain;
      if (!domain && content && memoryDomains.length > 0) {
        domain = inferDomain(content, memoryDomains, memoryDomainKeywords);
      }

      // Route 'project' to projectStore (internal target 'memory')
      const target = rawTarget as "memory" | "user" | "failure";
      const activeStore = rawTarget === "project" ? projectStore : store;

      if (rawTarget === "project" && !projectStore) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: "Project memory is not available (no project detected)." }) }],
          details: {},
        };
      }

      // After the guard above, activeStore is guaranteed non-null when rawTarget === 'project'
      const store_ = activeStore!;

      let result;
      switch (action) {
        case "add":
          if (!content) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: "Content is required for 'add' action.",
                  }),
                },
              ],
              details: {},
            };
          }
          // Handle failure target with category
          if (rawTarget === "failure") {
            const memoryCategory = (category || "failure") as MemoryCategory;
            result = await store_.addFailure(content, {
              category: memoryCategory,
              failureReason: failure_reason,
            });
            if (result.success) {
              try {
                addMemory(dbManager, content, "failure", domain || null, memoryCategory, failure_reason || null, null, null);
              } catch { /* Best-effort SQLite mirror */ }
            }
          } else {
            result = await store_.add(target, content, { domain });
            if (domain && (result as any).success) {
              (result as any).message = ((result as any).message || "Entry added.") + ` (domain=${domain})`;
            }
            if (result.success) {
              try {
                addMemory(dbManager, content, target, rawTarget === "project" ? projectName : (domain || null), category as MemoryCategory || null, failure_reason || null, null, null);
              } catch { /* Best-effort SQLite mirror */ }
              if (config?.cortexSyncEnabled && (target === "memory" || target === "user")) {
                try {
                  syncToCortex(config.cortexVaultPath!, content, target, domain ?? undefined);
                  (result as any).message = ((result as any).message || "Entry added.") + " (synced to Cortex)";
                } catch {
                  // Best-effort: Cortex sync is optional
                }
              }
            }
          }
          break;

        case "replace":
          if (!old_text) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: "old_text is required for 'replace' action.",
                  }),
                },
              ],
              details: {},
            };
          }
          if (!content) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: "content is required for 'replace' action.",
                  }),
                },
              ],
              details: {},
            };
          }
          result = await store_.replace(target, old_text, content);
          break;

        case "remove":
          if (!old_text) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: "old_text is required for 'remove' action.",
                  }),
                },
              ],
              details: {},
            };
          }
          result = await store_.remove(target, old_text);
          break;

        default:
          result = {
            success: false,
            error: `Unknown action '${action}'. Use: add, replace, remove`,
          };
      }

      // Tag project results so the caller knows the scope
      if (rawTarget === "project" && result.success) {
        (result as any).target = "project";
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
