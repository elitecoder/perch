import type { IToolPlugin } from '../plugins/interface.js'
import { normalizeLines, trimTrailingBlanks } from './utils.js'

export interface ParsedScreen {
  raw: string
  clean: string
  lines: string[]
}

/**
 * Strip terminal chrome from raw pane output and delegate meaningful
 * content extraction to the active plugin.
 */
export function parseScreen(raw: string, plugin: IToolPlugin): ParsedScreen {
  const lines = trimTrailingBlanks(normalizeLines(raw))
  const clean = lines.join('\n')
  const extracted = plugin.extractResponse(clean)
  return { raw, clean: extracted, lines }
}
