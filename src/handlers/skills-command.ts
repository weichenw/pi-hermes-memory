/**
 * Skills command — /memory-skills lists all agent-created skills.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SkillStore } from "../store/skill-store.js";

export function registerSkillsCommand(pi: ExtensionAPI, store: SkillStore): void {
  pi.registerCommand("memory-skills", {
    description: "List all agent-created skills (procedural memory)",
    handler: async (_args, ctx) => {
      const skills = await store.loadIndex();

      const lines: string[] = [];
      lines.push("");
      lines.push("  ╔══════════════════════════════════════════════╗");
      lines.push("  ║             🧠 Procedural Skills             ║");
      lines.push("  ╚══════════════════════════════════════════════╝");

      if (skills.length === 0) {
        lines.push("  (no skills created yet)");
        lines.push("");
        lines.push("  Skills are auto-created after complex tasks,");
        lines.push("  or you can ask the agent to create one.");
      } else {
        let totalTokens = 0;

        for (const skill of skills) {
          const doc = await store.loadSkill(skill.fileName);
          const tokens = doc ? Math.ceil(doc.body.length / 4) : 0;
          const chars = doc ? doc.body.length : 0;
          totalTokens += tokens;

          lines.push(`  📄 ${skill.name} · ${tokens} tokens (~${chars} chars)`);
          lines.push(`     ${skill.description}`);
          lines.push(`     file: ${skill.fileName}`);
          lines.push("");
        }

        lines.push(`  📊 ${totalTokens} tokens total`);
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
