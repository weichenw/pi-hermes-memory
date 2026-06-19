import { DatabaseManager } from './db.js';
import { buildFallbackFts5Query, isFts5QueryError, normalizeFts5Query } from './fts-query.js';
import type { MemoryCategory } from '../types.js';

/**
 * A memory entry stored in SQLite.
 */
export interface SqliteMemoryEntry {
  id: number;
  project: string | null;
  target: 'memory' | 'user' | 'failure';
  category: MemoryCategory | null;
  content: string;
  failureReason: string | null;
  toolState: string | null;
  correctedTo: string | null;
  created: string;
  lastReferenced: string;
}

/**
 * Add a memory entry to the SQLite store.
 * If an identical entry (same content + target + project + category) already
 * exists, updates its last_referenced date instead of inserting a duplicate.
 */
export function addMemory(
  dbManager: DatabaseManager,
  content: string,
  target: 'memory' | 'user' | 'failure' = 'memory',
  project: string | null = null,
  category: MemoryCategory | null = null,
  failureReason: string | null = null,
  toolState: string | null = null,
  correctedTo: string | null = null
): SqliteMemoryEntry {
  const db = dbManager.getDb();
  const today = new Date().toISOString().split('T')[0];

  // ── Deduplication check — exact match on content + target + project + category ──
  const existing = db.prepare(
    'SELECT id, created, last_referenced FROM memories WHERE content = ? AND target = ? AND project IS ? AND category IS ?'
  ).get(content, target, project, category) as { id: number; created: string; last_referenced: string } | undefined;

  if (existing) {
    // Touch the existing entry — update last_referenced + any new metadata
    db.prepare(
      'UPDATE memories SET last_referenced = ?, failure_reason = ?, tool_state = ?, corrected_to = ? WHERE id = ?'
    ).run(today, failureReason, toolState, correctedTo, existing.id);

    return {
      id: existing.id,
      project,
      target,
      category,
      content,
      failureReason,
      toolState,
      correctedTo,
      created: existing.created,
      lastReferenced: today,
    };
  }

  // ── Fresh insert ──
  const result = db.prepare(`
    INSERT INTO memories (project, target, category, content, failure_reason, tool_state, corrected_to, created, last_referenced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(project, target, category, content, failureReason, toolState, correctedTo, today, today);

  return {
    id: Number(result.lastInsertRowid),
    project,
    target,
    category,
    content,
    failureReason,
    toolState,
    correctedTo,
    created: today,
    lastReferenced: today,
  };
}

/**
 * Search memories using FTS5.
 */
export function searchMemories(
  dbManager: DatabaseManager,
  query: string,
  options: { project?: string; target?: string; category?: MemoryCategory; limit?: number } = {}
): SqliteMemoryEntry[] {
  if (query.trim().length === 0) return [];

  const db = dbManager.getDb();
  const { project, target, category, limit = 10 } = options;

  const normalizedQuery = normalizeFts5Query(query);
  if (normalizedQuery.length === 0) return [];

  const runSearch = (matchQuery: string): SqliteMemoryEntry[] => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // FTS5 match via subquery with normalized query
    conditions.push('m.id IN (SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?)');
    params.push(matchQuery);

    if (project !== undefined) {
      if (project === null) {
        conditions.push('m.project IS NULL');
      } else {
        conditions.push('m.project = ?');
        params.push(project);
      }
    }

    if (target) {
      conditions.push('m.target = ?');
      params.push(target);
    }

    if (category) {
      conditions.push('m.category = ?');
      params.push(category);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT id, project, target, category, content, failure_reason, tool_state, corrected_to, created, last_referenced
      FROM memories m
      ${whereClause}
      ORDER BY m.last_referenced DESC
      LIMIT ?
    `;
    params.push(limit);

    try {
      const rows = db.prepare(sql).all(...params) as Array<{
        id: number;
        project: string | null;
        target: string;
        category: string | null;
        content: string;
        failure_reason: string | null;
        tool_state: string | null;
        corrected_to: string | null;
        created: string;
        last_referenced: string;
      }>;

      return rows.map(row => ({
        id: row.id,
        project: row.project,
        target: row.target as 'memory' | 'user' | 'failure',
        category: row.category as MemoryCategory | null,
        content: row.content,
        failureReason: row.failure_reason,
        toolState: row.tool_state,
        correctedTo: row.corrected_to,
        created: row.created,
        lastReferenced: row.last_referenced,
      }));
    } catch (err) {
      // FTS5 can throw on malformed queries — return empty results, but
      // surface anything else so genuine DB errors aren't swallowed.
      if (isFts5QueryError(err)) return [];
      throw err;
    }
  };

  // Strict AND match first. For natural-language multi-term queries that find
  // nothing, retry with a broader OR query so a single matching term still hits.
  const exactResults = runSearch(normalizedQuery);
  if (exactResults.length > 0) return exactResults;

  const fallbackQuery = buildFallbackFts5Query(query);
  if (!fallbackQuery || fallbackQuery === normalizedQuery) return exactResults;

  return runSearch(fallbackQuery);
}

/**
 * Get all memories, optionally filtered.
 */
export function getMemories(
  dbManager: DatabaseManager,
  options: { project?: string | null; target?: string; category?: MemoryCategory } = {}
): SqliteMemoryEntry[] {
  const db = dbManager.getDb();
  const { project, target, category } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (project !== undefined) {
    if (project === null) {
      conditions.push('project IS NULL');
    } else {
      conditions.push('project = ?');
      params.push(project);
    }
  }

  if (target) {
    conditions.push('target = ?');
    params.push(target);
  }

  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT id, project, target, category, content, failure_reason, tool_state, corrected_to, created, last_referenced
    FROM memories
    ${whereClause}
    ORDER BY last_referenced DESC
  `).all(...params) as Array<{
    id: number;
    project: string | null;
    target: string;
    category: string | null;
    content: string;
    failure_reason: string | null;
    tool_state: string | null;
    corrected_to: string | null;
    created: string;
    last_referenced: string;
  }>;

  return rows.map(row => ({
    id: row.id,
    project: row.project,
    target: row.target as 'memory' | 'user' | 'failure',
    category: row.category as MemoryCategory | null,
    content: row.content,
    failureReason: row.failure_reason,
    toolState: row.tool_state,
    correctedTo: row.corrected_to,
    created: row.created,
    lastReferenced: row.last_referenced,
  }));
}

/**
 * Remove a memory by ID.
 */
export function removeMemory(dbManager: DatabaseManager, id: number): boolean {
  const db = dbManager.getDb();
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Get recent failure memories (last N days).
 */
export function getRecentFailures(
  dbManager: DatabaseManager,
  maxAgeDays = 7,
  project?: string | null
): SqliteMemoryEntry[] {
  const db = dbManager.getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const conditions: string[] = ['target = ?', 'created >= ?'];
  const params: unknown[] = ['failure', cutoffStr];

  if (project !== undefined) {
    if (project === null) {
      conditions.push('project IS NULL');
    } else {
      conditions.push('(project = ? OR project IS NULL)');
      params.push(project);
    }
  }

  const rows = db.prepare(`
    SELECT id, project, target, category, content, failure_reason, tool_state, corrected_to, created, last_referenced
    FROM memories
    WHERE ${conditions.join(' AND ')}
    ORDER BY created DESC
    LIMIT 5
  `).all(...params) as Array<{
    id: number;
    project: string | null;
    target: string;
    category: string | null;
    content: string;
    failure_reason: string | null;
    tool_state: string | null;
    corrected_to: string | null;
    created: string;
    last_referenced: string;
  }>;

  return rows.map(row => ({
    id: row.id,
    project: row.project,
    target: row.target as 'memory' | 'user' | 'failure',
    category: row.category as MemoryCategory | null,
    content: row.content,
    failureReason: row.failure_reason,
    toolState: row.tool_state,
    correctedTo: row.corrected_to,
    created: row.created,
    lastReferenced: row.last_referenced,
  }));
}

/**
 * Update a memory's last_referenced date.
 */
export function touchMemory(dbManager: DatabaseManager, id: number): void {
  const db = dbManager.getDb();
  const today = new Date().toISOString().split('T')[0];
  db.prepare('UPDATE memories SET last_referenced = ? WHERE id = ?').run(today, id);
}

/**
 * Get memory statistics.
 */
export function getMemoryStats(dbManager: DatabaseManager): {
  total: number;
  byProject: { project: string | null; count: number }[];
  byTarget: { target: string; count: number }[];
} {
  const db = dbManager.getDb();

  const total = (db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }).count;

  const byProject = db.prepare(`
    SELECT project, COUNT(*) as count
    FROM memories
    GROUP BY project
    ORDER BY count DESC
  `).all() as { project: string | null; count: number }[];

  const byTarget = db.prepare(`
    SELECT target, COUNT(*) as count
    FROM memories
    GROUP BY target
    ORDER BY count DESC
  `).all() as { target: string; count: number }[];

  return { total, byProject, byTarget };
}
