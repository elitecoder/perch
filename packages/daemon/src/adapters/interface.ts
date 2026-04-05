export interface Session {
  id: string
  name: string
  windows: Window[]
}

export interface Window {
  id: string
  name: string
  panes: Pane[]
}

export interface Pane {
  id: string // e.g. "tmux:session:window:pane"
  index: number
  active: boolean
  command: string // process running in this pane
  dimensions: { rows: number; cols: number }
}

export interface ITerminalAdapter {
  readonly name: string

  // Discovery
  isAvailable(): Promise<boolean>
  listSessions(): Promise<Session[]>

  // Reading
  readPane(paneId: string, lines?: number): Promise<string>

  /**
   * Return the PID of the process running directly in this pane (typically the
   * shell). Used by the transcript resolver to walk the process tree and find
   * the Claude Code session file. Optional — adapters that cannot provide this
   * should return null.
   */
  getPanePid?(paneId: string): Promise<number | null>

  // Writing
  sendText(paneId: string, text: string): Promise<void>
  sendKey(paneId: string, key: string): Promise<void>

  // Workspace management
  createSession(name: string, cwd?: string, command?: string): Promise<Session>
  renameSession(sessionId: string, name: string): Promise<void>
  closeSession(sessionId: string): Promise<void>
  splitPane(paneId: string, direction: 'left' | 'right' | 'up' | 'down'): Promise<Pane>
  selectPane(paneId: string): Promise<void>
}
