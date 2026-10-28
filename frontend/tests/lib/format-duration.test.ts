import { describe, expect, test } from 'bun:test';
import { formatDuration } from '../../src/lib/format-duration';

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
