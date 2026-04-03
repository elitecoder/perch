import { normalizeLines, trimTrailingBlanks } from '../screen-parser/utils.js'

export interface LineDiff {
  /** Lines only in curr (added) */
  added: string[]
  /** Lines only in prev (removed) */
  removed: string[]
  /** True if prev is a strict prefix of curr (pure append) */
  isAppend: boolean
}

/**
 * Compute a raw line-level diff between two screen snapshots.
 * Both strings are normalized (ANSI stripped, trimmed) before comparison.
 */
export function diffScreens(prev: string, curr: string): LineDiff {
  const prevLines = trimTrailingBlanks(normalizeLines(prev))
  const currLines = trimTrailingBlanks(normalizeLines(curr))

  const prevSet = new Set(prevLines)
  const added = currLines.filter(l => !prevSet.has(l))
  const currSet = new Set(currLines)
  const removed = prevLines.filter(l => !currSet.has(l))

  // Pure append: curr starts with all prev lines in order
  const isAppend =
    prevLines.length <= currLines.length &&
    prevLines.every((l, i) => currLines[i] === l)

  return { added, removed, isAppend }
}

/**
 * Returns true if a line should be suppressed based on the plugin's patterns.
 */
export function isSuppressed(line: string, patterns: RegExp[]): boolean {
  return patterns.some(re => re.test(line))
}

/**
 * Filter added lines through suppress patterns, returning only meaningful new content.
 */
export function meaningfulAdded(added: string[], patterns: RegExp[]): string[] {
  return added.filter(l => l.trim() !== '' && !isSuppressed(l, patterns))
}
