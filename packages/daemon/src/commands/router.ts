export interface ParsedCommand {
  name: string
  args: string[]
  raw: string
}

const ALIASES: Record<string, string> = {
  ls: 'list',
}

/**
 * Parse a raw Slack message text into a command name + args.
 * - Case-insensitive command name
 * - Strips leading/trailing whitespace
 * - Resolves known aliases (ls → list)
 * - Resolves bare numeric shorthand: "read 4" → args[0] = "4" (caller resolves pane)
 */
export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim()
  const parts = trimmed.split(/\s+/)
  const rawName = (parts[0] ?? '').toLowerCase()
  const name = ALIASES[rawName] ?? rawName
  const args = parts.slice(1)
  return { name, args, raw: trimmed }
}

export type CommandHandler = (
  args: string[],
  respond: (text: string) => Promise<void>,
) => Promise<void>

export class CommandRouter {
  private _handlers = new Map<string, CommandHandler>()

  register(name: string, handler: CommandHandler): void {
    this._handlers.set(name.toLowerCase(), handler)
  }

  async dispatch(
    text: string,
    respond: (text: string) => Promise<void>,
  ): Promise<void> {
    const { name, args } = parseCommand(text)
    const handler = this._handlers.get(name)
    if (!handler) {
      await respond(`:grey_question: Unknown command \`${name}\`. Type \`help\` for a list of commands.`)
      return
    }
    try {
      await handler(args, respond)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await respond(`:x: Error running \`${name}\`: ${msg}`)
    }
  }
}
