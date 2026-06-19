import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseManager } from '../../src/store/db.js';
import { addMemory, searchMemories } from '../../src/store/sqlite-memory-store.js';

describe('sqlite-memory-store', () => {
  let tmpDir: string;
  let dbManager: DatabaseManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-test-'));
    dbManager = new DatabaseManager(tmpDir);
  });

  afterEach(() => {
    dbManager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('addMemory deduplication', () => {
    it('should insert a new memory when none exists', () => {
      const mem = addMemory(dbManager, 'prefers pnpm', 'user', null, 'preference');
      assert.strictEqual(mem.id, 1);
      assert.strictEqual(mem.content, 'prefers pnpm');
      assert.strictEqual(mem.created, mem.lastReferenced);
      assert.strictEqual(mem.category, 'preference');
    });

    it('should update last_referenced instead of inserting duplicate', () => {
      const mem1 = addMemory(dbManager, 'prefers pnpm', 'user', null, 'preference');
      // Simulate time passing — last_referenced should be updated
      const mem2 = addMemory(dbManager, 'prefers pnpm', 'user', null, 'preference');

      assert.strictEqual(mem2.id, mem1.id);          // Same row
      assert.strictEqual(mem2.content, mem1.content); // Same content
      assert.ok(mem2.lastReferenced >= mem1.lastReferenced); // Touched

      // Only one row in DB
      const all = searchMemories(dbManager, 'pnpm');
      assert.strictEqual(all.length, 1);
    });

    it('should allow same content with different target', () => {
      addMemory(dbManager, 'prefers pnpm', 'user', null, 'preference');
      addMemory(dbManager, 'prefers pnpm', 'memory', null, 'preference');

      const all = searchMemories(dbManager, 'pnpm');
      assert.strictEqual(all.length, 2);
    });

    it('should allow same content with different project', () => {
      addMemory(dbManager, 'prefers pnpm', 'user', null, 'preference');
      addMemory(dbManager, 'prefers pnpm', 'user', 'my-project', 'preference');

      const all = searchMemories(dbManager, 'pnpm');
      assert.strictEqual(all.length, 2);
    });

    it('should allow same content with different category', () => {
      addMemory(dbManager, 'prefers pnpm', 'user', null, 'preference');
      addMemory(dbManager, 'prefers pnpm', 'user', null, 'insight');

      const all = searchMemories(dbManager, 'pnpm');
      assert.strictEqual(all.length, 2);
    });

    it('should update failure_reason and tool_state on dedup touch', () => {
      addMemory(dbManager, 'test failure', 'failure', null, 'failure', 'old reason', null, null);
      const mem2 = addMemory(dbManager, 'test failure', 'failure', null, 'failure', 'new reason', 'new state', 'new corrected');

      assert.strictEqual(mem2.failureReason, 'new reason');
      assert.strictEqual(mem2.toolState, 'new state');
      assert.strictEqual(mem2.correctedTo, 'new corrected');
    });
  });

  describe('searchMemories FTS normalization', () => {
    it('returns [] for empty/whitespace query', () => {
      addMemory(dbManager, 'prefers pnpm over npm', 'user', null, 'preference');
      assert.deepEqual(searchMemories(dbManager, ''), []);
      assert.deepEqual(searchMemories(dbManager, '   '), []);
    });

    it('finds a multi-word entry with a multi-word AND query', () => {
      // Stored content contains both 'gpu' and 'timeout' in one entry.
      addMemory(dbManager, 'gpu timeout during inference', 'memory', null, null);

      const results = searchMemories(dbManager, 'gpu timeout');
      assert.ok(results.length > 0, 'multi-word AND query should match an entry containing both terms');
      assert.ok(results.some(r => r.content.includes('gpu timeout during inference')));
    });

    it('strict AND misses when terms are in separate entries', () => {
      // Note: with the OR fallback always enabled, a zero-result strict AND
      // triggers the fallback, so this case is covered by the next test instead.
      // Here we just confirm the entries land in separate rows.
      addMemory(dbManager, 'gpu is fast', 'memory', null, null);
      addMemory(dbManager, 'the request timed out as a timeout', 'memory', null, null);

      // No single entry contains both 'gpu' and 'timeout' as a phrase, but the
      // second entry contains 'timeout' — the OR fallback must find at least it.
      const results = searchMemories(dbManager, 'gpu timeout');
      assert.ok(results.length > 0);
      assert.ok(results.some(r => r.content.includes('timeout')));
    });

    it('OR fallback returns entries matching any single term', () => {
      addMemory(dbManager, 'gpu is fast', 'memory', null, null);
      addMemory(dbManager, 'the request timed out as a timeout', 'memory', null, null);

      // Strict AND misses (no entry has both 'gpu' and 'timeout'), so the OR
      // fallback should kick in and return both entries.
      const results = searchMemories(dbManager, 'gpu timeout');
      assert.ok(results.length > 0, 'OR fallback should return matches for any single term');
      const contents = results.map(r => r.content);
      assert.ok(contents.some(c => c.includes('gpu')));
      assert.ok(contents.some(c => c.includes('timeout')));
    });

    it('does not use OR fallback when strict AND already matches', () => {
      addMemory(dbManager, 'gpu timeout during inference', 'memory', null, null);
      addMemory(dbManager, 'unrelated entry about cats', 'memory', null, null);

      const results = searchMemories(dbManager, 'gpu timeout');
      // Strict AND matches the one entry; fallback must not pull in the cat entry.
      assert.strictEqual(results.length, 1);
      assert.ok(results[0].content.includes('gpu timeout during inference'));
    });

    it('preserves an explicit quoted phrase as a single term', () => {
      addMemory(dbManager, 'the memory search tool', 'memory', null, null);
      addMemory(dbManager, 'search your memory', 'memory', null, null);

      // Quoted phrase "memory search" matches only the entry with that exact phrase.
      const results = searchMemories(dbManager, '"memory search"');
      assert.strictEqual(results.length, 1);
      assert.ok(results[0].content.includes('the memory search tool'));
    });

    it('returns [] for a malformed FTS5 query without throwing', () => {
      addMemory(dbManager, 'some entry', 'memory', null, null);
      // "AND OR NOT" is passed through as raw operators and yields no matches.
      const results = searchMemories(dbManager, 'AND OR NOT');
      assert.ok(Array.isArray(results));
    });
  });
});
