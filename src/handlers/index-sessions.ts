/**
 * Index sessions command — /memory-index-sessions syncs disk sessions with SQLite.
 *
 * Performs three operations:
 * 1. Indexes new sessions from disk (not yet in DB)
 * 2. Removes orphaned sessions (in DB but no file on disk)
 * 3. Prunes sessions older than the retention threshold
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DatabaseManager } from "../store/db.js";
import { getSessionStats } from "../store/session-indexer.js";
import { syncAllSessions } from "../store/session-sync.js";
import { loadConfig } from "../config.js";

const SESSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "sessions");

export function registerIndexSessionsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("memory-index-sessions", {
    description:
      "Sync past Pi sessions with the search database (index new, remove orphaned, prune old)",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      // Show initial progress
      ctx.ui.notify("🔍 Scanning session directories...", "info");

      try {
        // Count sessions first for progress display
        let totalFiles = 0;
        let projectDirs: string[] = [];
        if (fs.existsSync(SESSIONS_DIR)) {
          projectDirs = fs
            .readdirSync(SESSIONS_DIR)
            .filter((d) => fs.statSync(path.join(SESSIONS_DIR, d)).isDirectory());
          for (const dir of projectDirs) {
            const files = fs
              .readdirSync(path.join(SESSIONS_DIR, dir))
              .filter((f) => f.endsWith(".jsonl"));
            totalFiles += files.length;
          }
        }

        ctx.ui.notify(
          `📁 Found ${totalFiles} session files across ${projectDirs.length} projects\n⏳ Syncing...`,
          "info",
        );

        const config = loadConfig();
        const memoryDir = path.join(os.homedir(), ".pi", "agent", "memory");
        const dbManager = new DatabaseManager(memoryDir);

        try {
          const result = syncAllSessions(dbManager, SESSIONS_DIR, {
            retentionDays: config.sessionRetentionDays,
            memoryRetentionDays: config.memoryRetentionDays,
          });
          const stats = getSessionStats(dbManager);

          let output = `\n✅ Session sync complete!\n\n`;
          output += `📊 Changes:\n`;
          if (result.indexed > 0)
            output += `├─ Sessions indexed: ${result.indexed}\n`;
          if (result.skipped > 0)
            output += `├─ Sessions skipped: ${result.skipped}\n`;
          if (result.orphanedDeleted > 0)
            output += `├─ Orphaned sessions removed: ${result.orphanedDeleted}\n`;
          if (result.oldDeleted > 0)
            output += `├─ Old sessions pruned (retention=${config.sessionRetentionDays}d): ${result.oldDeleted}\n`;
          if (result.memoriesDeleted > 0)
            output += `├─ Old memories pruned (retention=${config.memoryRetentionDays}d): ${result.memoriesDeleted}\n`;
          output += `└─ Total in DB: ${stats.totalSessions} sessions, ${stats.totalMessages} messages\n`;

          if (stats.projects.length > 0) {
            output += `\n📁 Projects indexed:\n`;
            for (const p of stats.projects) {
              output += `├─ ${p.project}: ${p.sessions} sessions, ${p.messages} messages\n`;
            }
          }

          if (result.errors.length > 0) {
            output += `\n⚠️ Errors (${result.errors.length}):\n`;
            for (const err of result.errors.slice(0, 3)) {
              output += `├─ ${err}\n`;
            }
            if (result.errors.length > 3) {
              output += `└─ ... and ${result.errors.length - 3} more\n`;
            }
          }

          output += `\n💡 Use the session_search tool to search across indexed sessions.`;

          ctx.ui.notify(output, "info");
        } finally {
          dbManager.close();
        }
      } catch (err) {
        ctx.ui.notify(
          `❌ Session sync failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });
}
