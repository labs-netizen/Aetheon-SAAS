/**
 * Indian 15-Minute Electricity Block Utilities (Blocks 1 - 96)
 * Supports canonical conversions between Block Index, Operating Date, and UTC/IST timestamps.
 */

export interface BlockTiming {
  blockIndex: number;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
}

/**
 * Returns HH:MM start and end times for any Indian electricity block (1 to 96).
 */
export function getBlockTimes(blockIndex: number): BlockTiming {
  if (blockIndex < 1 || blockIndex > 96 || !Number.isInteger(blockIndex)) {
    throw new Error(`Invalid block index: ${blockIndex}. Indian electricity blocks must be integers between 1 and 96.`);
  }

  const startMinutes = (blockIndex - 1) * 15;
  const endMinutes = blockIndex * 15;

  const startH = Math.floor(startMinutes / 60);
  const startM = startMinutes % 60;
  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;

  const formatH = (h: number) => h.toString().padStart(2, '0');
  const formatM = (m: number) => m.toString().padStart(2, '0');

  const startTime = `${formatH(startH)}:${formatM(startM)}`;
  const endTime = endH === 24 ? '24:00' : `${formatH(endH)}:${formatM(endM)}`;

  return {
    blockIndex,
    startTime,
    endTime,
  };
}

/**
 * Generate all 96 block timings for an operating day.
 */
export function getAllBlockTimings(): BlockTiming[] {
  const timings: BlockTiming[] = [];
  for (let b = 1; b <= 96; b++) {
    timings.push(getBlockTimes(b));
  }
  return timings;
}

/**
 * Given a time string HH:MM (00:00 to 23:59), returns the matching 1-based block index (1-96).
 */
export function timeToBlockIndex(timeStr: string): number {
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);

  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid time format: "${timeStr}". Expected HH:MM between 00:00 and 23:59.`);
  }

  const totalMinutes = h * 60 + m;
  const block = Math.floor(totalMinutes / 15) + 1;
  return Math.min(96, Math.max(1, block));
}

/**
 * Convert Date and Block Index to canonical UTC ISO timestamp (IST is UTC+05:30).
 */
export function blockToUtcIso(operatingDate: string, blockIndex: number): string {
  const timing = getBlockTimes(blockIndex);
  const [hStr, mStr] = timing.startTime.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);

  // IST is UTC+05:30 -> subtract 5h 30m for UTC
  const [year, month, day] = operatingDate.split('-').map(Number);
  const dateObj = new Date(Date.UTC(year, month - 1, day, h, m, 0));
  dateObj.setUTCMinutes(dateObj.getUTCMinutes() - 330);

  return dateObj.toISOString();
}

/**
 * Validate that an interval dataset contains exactly 96 contiguous blocks without gaps.
 */
export function validate96BlockContiguity(blocks: { block_index: number }[]): {
  isValid: boolean;
  missingBlocks: number[];
  duplicateBlocks: number[];
} {
  const seen = new Set<number>();
  const duplicates = new Set<number>();

  for (const b of blocks) {
    if (seen.has(b.block_index)) {
      duplicates.add(b.block_index);
    }
    seen.add(b.block_index);
  }

  const missing: number[] = [];
  for (let i = 1; i <= 96; i++) {
    if (!seen.has(i)) {
      missing.push(i);
    }
  }

  return {
    isValid: missing.length === 0 && duplicates.size === 0,
    missingBlocks: missing,
    duplicateBlocks: Array.from(duplicates),
  };
}
