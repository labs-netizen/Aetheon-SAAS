import { describe, it, expect } from 'vitest';
import {
  getBlockTimes,
  getAllBlockTimings,
  timeToBlockIndex,
  blockToUtcIso,
  validate96BlockContiguity,
} from '@/lib/dates/blocks96';

describe('Indian 15-Minute Electricity Block Utilities (Blocks 1 - 96)', () => {
  it('should generate accurate start and end times for Block 1', () => {
    const b1 = getBlockTimes(1);
    expect(b1.startTime).toBe('00:00');
    expect(b1.endTime).toBe('00:15');
  });

  it('should generate accurate start and end times for Block 48 (Midday)', () => {
    const b48 = getBlockTimes(48);
    expect(b48.startTime).toBe('11:45');
    expect(b48.endTime).toBe('12:00');
  });

  it('should generate accurate start and end times for Block 96 (Midnight End)', () => {
    const b96 = getBlockTimes(96);
    expect(b96.startTime).toBe('23:45');
    expect(b96.endTime).toBe('24:00');
  });

  it('should throw error for out-of-bounds block index', () => {
    expect(() => getBlockTimes(0)).toThrow();
    expect(() => getBlockTimes(97)).toThrow();
    expect(() => getBlockTimes(12.5)).toThrow();
  });

  it('should generate exactly 96 blocks for full operating day', () => {
    const all = getAllBlockTimings();
    expect(all).toHaveLength(96);
    expect(all[0].blockIndex).toBe(1);
    expect(all[95].blockIndex).toBe(96);
  });

  it('should map time string to matching block index', () => {
    expect(timeToBlockIndex('00:00')).toBe(1);
    expect(timeToBlockIndex('00:14')).toBe(1);
    expect(timeToBlockIndex('00:15')).toBe(2);
    expect(timeToBlockIndex('12:00')).toBe(49);
    expect(timeToBlockIndex('23:59')).toBe(96);
  });

  it('should validate contiguity of 96 blocks without gaps or duplicates', () => {
    const complete = Array.from({ length: 96 }, (_, i) => ({ block_index: i + 1 }));
    const result = validate96BlockContiguity(complete);
    expect(result.isValid).toBe(true);
    expect(result.missingBlocks).toHaveLength(0);
    expect(result.duplicateBlocks).toHaveLength(0);
  });

  it('should detect missing blocks and duplicates', () => {
    const incomplete = [
      { block_index: 1 },
      { block_index: 2 },
      { block_index: 2 }, // duplicate
      { block_index: 4 }, // missing block 3
    ];
    const result = validate96BlockContiguity(incomplete);
    expect(result.isValid).toBe(false);
    expect(result.missingBlocks).toContain(3);
    expect(result.duplicateBlocks).toContain(2);
  });
});
