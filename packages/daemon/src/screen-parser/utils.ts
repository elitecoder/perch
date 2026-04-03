const ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJKST]|\x1b[()][AB012]|\x1b=/g
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '').replace(CONTROL_RE, '')
}

export function normalizeLines(s: string): string[] {
  return stripAnsi(s)
    .split('\n')
    .map(l => l.trimEnd())
}

export function trimTrailingBlanks(lines: string[]): string[] {
  let end = lines.length
  while (end > 0 && lines[end - 1] === '') end--
  return lines.slice(0, end)
}
