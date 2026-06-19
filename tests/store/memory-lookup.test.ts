import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMemoryLookupText } from '../../src/store/memory-lookup.js';

describe('normalizeMemoryLookupText', () => {
  it('returns empty string for empty/whitespace input', () => {
    assert.equal(normalizeMemoryLookupText(''), '');
    assert.equal(normalizeMemoryLookupText('   '), '');
    assert.equal(normalizeMemoryLookupText('\n\n'), '');
  });

  it('leaves plain entry text unchanged', () => {
    assert.equal(normalizeMemoryLookupText('prefers pnpm over npm'), 'prefers pnpm over npm');
  });

  it('strips a leading emoji + scope tag from a memory_search line', () => {
    assert.equal(
      normalizeMemoryLookupText('🧠 [global] prefers pnpm over npm'),
      'prefers pnpm over npm'
    );
  });

  it('strips the user-profile emoji + scope tag', () => {
    assert.equal(
      normalizeMemoryLookupText('👤 [global] lives in Sydney'),
      'lives in Sydney'
    );
  });

  it('strips a failure/warning emoji + tag', () => {
    assert.equal(
      normalizeMemoryLookupText('⚠️ [global] retry with --force'),
      'retry with --force'
    );
  });

  it('collapses a doubled leading tag when an emoji+scope prefix was stripped first', () => {
    // Realistic render: emoji + scope, then a doubled category tag.
    assert.equal(
      normalizeMemoryLookupText('⚠️ [global] [correction] [correction] retry with --force'),
      '[correction] retry with --force'
    );
  });

  it('strips both tags when a doubled leading tag has no emoji prefix', () => {
    // Without an emoji+scope prefix, the first regex eats both bracketed tags.
    // The result is still a substring of the stored entry, so remove/replace match.
    assert.equal(
      normalizeMemoryLookupText('[correction] [correction] retry with --force'),
      'retry with --force'
    );
  });

  it('collapses to the first non-empty line for multi-line pastes', () => {
    const pasted = '🧠 [global] prefers pnpm over npm\n\n  (other context lines)';
    assert.equal(normalizeMemoryLookupText(pasted), 'prefers pnpm over npm');
  });

  it('does not strip a leading word without a bracketed scope tag', () => {
    // No bracketed scope tag → the prefix-stripping regex must not fire
    assert.equal(normalizeMemoryLookupText('user prefers vim'), 'user prefers vim');
  });

  it('returns empty for whitespace-only after trimming', () => {
    assert.equal(normalizeMemoryLookupText('   \n\t  '), '');
  });
});