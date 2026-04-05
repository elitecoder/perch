import { open, stat } from 'fs/promises'
import type { FileHandle } from 'fs/promises'
import { parseRecord, type TranscriptRecord } from './types.js'

/**
 * Incrementally reads new lines from a Claude Code JSONL transcript file.
 * Tracks a byte offset so each call to readNew() only returns records added
 * since the last read.
 */
export class TranscriptReader {
  private _offset = 0
  private _fh: FileHandle | null = null

  constructor(readonly filePath: string) {}

  /**
   * Read any new records written since the last call.
   * Returns an empty array if the file doesn't exist yet or hasn't grown.
   */
  async readNew(): Promise<TranscriptRecord[]> {
    let fileSize: number
    try {
      const s = await stat(this.filePath)
      fileSize = s.size
    } catch {
      return [] // file doesn't exist yet
    }

    // Handle file truncation / rotation
    if (fileSize < this._offset) {
      this._offset = 0
      await this._close()
    }

    if (fileSize === this._offset) return [] // nothing new

    if (!this._fh) {
      try {
        this._fh = await open(this.filePath, 'r')
      } catch {
        return []
      }
    }

    const bufSize = fileSize - this._offset
    const buf = Buffer.allocUnsafe(bufSize)
    const { bytesRead } = await this._fh.read(buf, 0, bufSize, this._offset)
    this._offset += bytesRead

    const chunk = buf.subarray(0, bytesRead).toString('utf8')
    const records: TranscriptRecord[] = []

    for (const line of chunk.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const record = parseRecord(trimmed)
      if (record !== null) records.push(record)
    }

    return records
  }

  /**
   * Seek to the current end of the file so only content written after this
   * point will be returned by readNew(). Call this when attaching to an
   * already-running session to avoid replaying history.
   */
  async seekToEnd(): Promise<void> {
    try {
      const s = await stat(this.filePath)
      this._offset = s.size
    } catch {
      // file doesn't exist yet — offset stays at 0, seekToEnd is a no-op
    }
  }

  /** Reset offset — next readNew() will re-read from the beginning. */
  reset(): void {
    this._offset = 0
  }

  async close(): Promise<void> {
    await this._close()
  }

  private async _close(): Promise<void> {
    if (this._fh) {
      try { await this._fh.close() } catch { /* ignore */ }
      this._fh = null
    }
  }
}
