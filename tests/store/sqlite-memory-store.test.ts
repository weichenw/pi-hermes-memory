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
});
