/**
 * Tests for content change tracking
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { trackChange, getSnapshot, clearSnapshots } from '../core/change-tracking.js';
import { createHash } from 'crypto';
describe('change tracking', () => {
    const testUrl = 'https://example.com/test-page';
    const testContent = 'This is test content';
    const testFingerprint = createHash('sha256').update(testContent).digest('hex');
    beforeEach(async () => {
        // Clear any existing snapshots for test URL
        await clearSnapshots('example\\.com');
    });
    it('marks first visit as new', async () => {
        const result = await trackChange(testUrl, testContent, testFingerprint);
        expect(result.changeStatus).toBe('new');
        expect(result.previousScrapeAt).toBeNull();
        expect(result.diff).toBeUndefined();
    });
    it('saves snapshot on first visit', async () => {
        await trackChange(testUrl, testContent, testFingerprint);
        const snapshot = await getSnapshot(testUrl);
        expect(snapshot).not.toBeNull();
        expect(snapshot?.url).toBe(testUrl);
        expect(snapshot?.content).toBe(testContent);
        expect(snapshot?.fingerprint).toBe(testFingerprint);
    });
    it('marks identical content as same', async () => {
        // First visit
        await trackChange(testUrl, testContent, testFingerprint);
        // Second visit with same content
        const result = await trackChange(testUrl, testContent, testFingerprint);
        expect(result.changeStatus).toBe('same');
        expect(result.previousScrapeAt).toBeTruthy();
        expect(result.diff).toBeUndefined();
    });
    it('detects changed content', async () => {
        // First visit
        await trackChange(testUrl, testContent, testFingerprint);
        // Second visit with different content
        const newContent = 'This is updated content';
        const newFingerprint = createHash('sha256').update(newContent).digest('hex');
        const result = await trackChange(testUrl, newContent, newFingerprint);
        expect(result.changeStatus).toBe('changed');
        expect(result.previousScrapeAt).toBeTruthy();
        expect(result.diff).toBeDefined();
    });
    it('includes diff with additions and deletions', async () => {
        const originalContent = `Line 1
Line 2
Line 3`;
        const originalFingerprint = createHash('sha256').update(originalContent).digest('hex');
        await trackChange(testUrl, originalContent, originalFingerprint);
        const changedContent = `Line 1
Line 2 modified
Line 3
Line 4 added`;
        const changedFingerprint = createHash('sha256').update(changedContent).digest('hex');
        const result = await trackChange(testUrl, changedContent, changedFingerprint);
        expect(result.diff).toBeDefined();
        expect(result.diff.additions).toBeGreaterThan(0);
        expect(result.diff.deletions).toBeGreaterThan(0);
        expect(result.diff.text).toBeTruthy();
    });
    it('updates snapshot timestamp on same content', async () => {
        await trackChange(testUrl, testContent, testFingerprint);
        const firstSnapshot = await getSnapshot(testUrl);
        const firstTimestamp = firstSnapshot?.timestamp;
        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 10));
        await trackChange(testUrl, testContent, testFingerprint);
        const secondSnapshot = await getSnapshot(testUrl);
        const secondTimestamp = secondSnapshot?.timestamp;
        expect(secondTimestamp).toBeGreaterThan(firstTimestamp);
    });
    it('stores previous fingerprint in metadata on change', async () => {
        await trackChange(testUrl, testContent, testFingerprint);
        const newContent = 'New content';
        const newFingerprint = createHash('sha256').update(newContent).digest('hex');
        await trackChange(testUrl, newContent, newFingerprint);
        const snapshot = await getSnapshot(testUrl);
        expect(snapshot?.metadata?.previousFingerprint).toBe(testFingerprint);
    });
    it('returns null for non-existent snapshot', async () => {
        const snapshot = await getSnapshot('https://nonexistent.example.com/page');
        expect(snapshot).toBeNull();
    });
    it('clears all snapshots when no pattern provided', async () => {
        await trackChange('https://example1.com/page', 'Content 1', createHash('sha256').update('Content 1').digest('hex'));
        await trackChange('https://example2.com/page', 'Content 2', createHash('sha256').update('Content 2').digest('hex'));
        const cleared = await clearSnapshots();
        expect(cleared).toBeGreaterThanOrEqual(2);
        const snapshot1 = await getSnapshot('https://example1.com/page');
        const snapshot2 = await getSnapshot('https://example2.com/page');
        expect(snapshot1).toBeNull();
        expect(snapshot2).toBeNull();
    });
    it('clears snapshots matching URL pattern', async () => {
        await trackChange('https://example.com/page1', 'Content 1', createHash('sha256').update('Content 1').digest('hex'));
        await trackChange('https://other.com/page2', 'Content 2', createHash('sha256').update('Content 2').digest('hex'));
        const cleared = await clearSnapshots('example\\.com');
        expect(cleared).toBeGreaterThanOrEqual(1);
        const snapshot1 = await getSnapshot('https://example.com/page1');
        const snapshot2 = await getSnapshot('https://other.com/page2');
        expect(snapshot1).toBeNull();
        expect(snapshot2).not.toBeNull(); // Other domain not cleared
    });
    it('handles multiple URLs independently', async () => {
        const url1 = 'https://example.com/page1';
        const url2 = 'https://example.com/page2';
        const content1 = 'Content 1';
        const content2 = 'Content 2';
        const fp1 = createHash('sha256').update(content1).digest('hex');
        const fp2 = createHash('sha256').update(content2).digest('hex');
        await trackChange(url1, content1, fp1);
        await trackChange(url2, content2, fp2);
        const snapshot1 = await getSnapshot(url1);
        const snapshot2 = await getSnapshot(url2);
        expect(snapshot1?.content).toBe(content1);
        expect(snapshot2?.content).toBe(content2);
    });
    it('computes accurate diff statistics', async () => {
        const original = `Line 1
Line 2
Line 3
Line 4`;
        const originalFp = createHash('sha256').update(original).digest('hex');
        await trackChange(testUrl, original, originalFp);
        const changed = `Line 1
Line 2 changed
Line 4
Line 5`;
        const changedFp = createHash('sha256').update(changed).digest('hex');
        const result = await trackChange(testUrl, changed, changedFp);
        expect(result.diff).toBeDefined();
        expect(result.diff.changes).toBeDefined();
        expect(result.diff.changes.length).toBeGreaterThan(0);
        // Verify change types are present
        const types = result.diff.changes.map(c => c.type);
        expect(types).toContain('add');
        expect(types).toContain('del');
    });
    it('handles empty content gracefully', async () => {
        const emptyContent = '';
        const emptyFp = createHash('sha256').update(emptyContent).digest('hex');
        const result = await trackChange(testUrl, emptyContent, emptyFp);
        expect(result.changeStatus).toBe('new');
        const snapshot = await getSnapshot(testUrl);
        expect(snapshot?.content).toBe('');
    });
    it('preserves previousScrapeAt timestamp', async () => {
        await trackChange(testUrl, testContent, testFingerprint);
        const firstSnapshot = await getSnapshot(testUrl);
        const firstTime = new Date(firstSnapshot.timestamp).toISOString();
        await new Promise(resolve => setTimeout(resolve, 10));
        const result = await trackChange(testUrl, testContent, testFingerprint);
        expect(result.previousScrapeAt).toBe(firstTime);
    });
    it('returns change status for completely different content', async () => {
        const original = 'Original content';
        const originalFp = createHash('sha256').update(original).digest('hex');
        await trackChange(testUrl, original, originalFp);
        const different = 'Completely different content with no overlap';
        const differentFp = createHash('sha256').update(different).digest('hex');
        const result = await trackChange(testUrl, different, differentFp);
        expect(result.changeStatus).toBe('changed');
        expect(result.diff.deletions).toBeGreaterThan(0);
        expect(result.diff.additions).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=change-tracking.test.js.map