import { describe, expect, test } from 'bun:test';
import { formatDuration, formatTimestamp } from '../../src/lib/format-duration';

describe('formatDuration', () => {
  test('formats under an hour as MM:SS', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(7.9)).toBe('00:07');
    expect(formatDuration(767)).toBe('12:47');
  });

  test('formats an hour and up as H:MM:SS', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(4325)).toBe('1:12:05');
  });

  test('treats invalid input as zero', () => {
    expect(formatDuration(-5)).toBe('00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00');
  });
});

describe('formatTimestamp', () => {
  test('formats under an hour as M:SS without padding the minutes', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(5.9)).toBe('0:05');
    expect(formatTimestamp(402)).toBe('6:42');
    expect(formatTimestamp(767)).toBe('12:47');
  });

  test('formats an hour and up as H:MM:SS', () => {
    expect(formatTimestamp(3600)).toBe('1:00:00');
    expect(formatTimestamp(3723)).toBe('1:02:03');
  });

  test('treats invalid input as zero', () => {
    expect(formatTimestamp(-5)).toBe('0:00');
    expect(formatTimestamp(Number.NaN)).toBe('0:00');
  });
});
