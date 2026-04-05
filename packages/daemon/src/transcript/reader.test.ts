import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { writeFile, rm, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { TranscriptReader } from './reader.js'

const tmp = join(tmpdir(), 'perch-reader-test')

beforeEach(async () => {
  await mkdir(tmp, { recursive: true })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function jsonlPath(name = 'session.jsonl'): string {
  return join(tmp, name)
}

describe('TranscriptReader', () => {
  it('returns empty array when file does not exist', async () => {
    const reader = new TranscriptReader(jsonlPath('missing.jsonl'))
    expect(await reader.readNew()).toEqual([])
    await reader.close()
  })

  it('reads records from a fresh file', async () => {
    const path = jsonlPath()
    await writeFile(path, '{"type":"user","message":{"role":"user","content":"hello"}}\n')
    const reader = new TranscriptReader(path)
    const records = await reader.readNew()
    expect(records).toHaveLength(1)
    expect(records[0]!.type).toBe('user')
    await reader.close()
  })

  it('returns only new records on subsequent reads', async () => {
    const path = jsonlPath()
    await writeFile(path, '{"type":"user","message":{"role":"user","content":"first"}}\n')
    const reader = new TranscriptReader(path)
    const first = await reader.readNew()
    expect(first).toHaveLength(1)

    // append a second record
    const { appendFile } = await import('fs/promises')
    await appendFile(path, '{"type":"assistant","message":{"role":"assistant","content":[],"stop_reason":"end_turn","model":"claude"}}\n')
    const second = await reader.readNew()
    expect(second).toHaveLength(1)
    expect(second[0]!.type).toBe('assistant')
    await reader.close()
  })

  it('skips malformed lines without throwing', async () => {
    const path = jsonlPath()
    await writeFile(path, 'not json\n{"type":"user","message":{"role":"user","content":"ok"}}\n')
    const reader = new TranscriptReader(path)
    const records = await reader.readNew()
    expect(records).toHaveLength(1)
    expect(records[0]!.type).toBe('user')
    await reader.close()
  })

  it('returns empty array when file has not grown', async () => {
    const path = jsonlPath()
    await writeFile(path, '{"type":"user","message":{"role":"user","content":"x"}}\n')
    const reader = new TranscriptReader(path)
    await reader.readNew()
    // read again with no new data
    expect(await reader.readNew()).toEqual([])
    await reader.close()
  })

  it('handles reset by re-reading from beginning', async () => {
    const path = jsonlPath()
    await writeFile(path, '{"type":"user","message":{"role":"user","content":"x"}}\n')
    const reader = new TranscriptReader(path)
    const first = await reader.readNew()
    expect(first).toHaveLength(1)
    reader.reset()
    const again = await reader.readNew()
    expect(again).toHaveLength(1)
    await reader.close()
  })
})
