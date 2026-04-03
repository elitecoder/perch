import { describe, expect, it, vi } from 'vitest'
import { CommandRouter, parseCommand } from './router.js'

describe('parseCommand', () => {
  it('lowercases the command name', () => {
    expect(parseCommand('READ pane1').name).toBe('read')
  })

  it('splits args correctly', () => {
    const { name, args } = parseCommand('send %0 hello world')
    expect(name).toBe('send')
    expect(args).toEqual(['%0', 'hello', 'world'])
  })

  it('resolves ls alias to list', () => {
    expect(parseCommand('ls').name).toBe('list')
  })

  it('handles leading/trailing whitespace', () => {
    expect(parseCommand('  help  ').name).toBe('help')
  })

  it('returns empty args for bare command', () => {
    expect(parseCommand('status').args).toEqual([])
  })
})

describe('CommandRouter', () => {
  it('dispatches to registered handler', async () => {
    const router = new CommandRouter()
    const handler = vi.fn().mockResolvedValue(undefined)
    router.register('test', handler)

    const respond = vi.fn()
    await router.dispatch('test arg1', respond)
    expect(handler).toHaveBeenCalledWith(['arg1'], respond)
  })

  it('responds with unknown command message for unregistered command', async () => {
    const router = new CommandRouter()
    const respond = vi.fn().mockResolvedValue(undefined)
    await router.dispatch('unknown', respond)
    expect(respond).toHaveBeenCalledWith(expect.stringContaining('Unknown command'))
  })

  it('responds with error message when handler throws', async () => {
    const router = new CommandRouter()
    router.register('boom', async () => { throw new Error('exploded') })
    const respond = vi.fn().mockResolvedValue(undefined)
    await router.dispatch('boom', respond)
    expect(respond).toHaveBeenCalledWith(expect.stringContaining('exploded'))
  })

  it('is case-insensitive for registered command names', async () => {
    const router = new CommandRouter()
    const handler = vi.fn().mockResolvedValue(undefined)
    router.register('List', handler)
    await router.dispatch('LIST', vi.fn())
    expect(handler).toHaveBeenCalled()
  })

  it('resolves ls alias automatically', async () => {
    const router = new CommandRouter()
    const handler = vi.fn().mockResolvedValue(undefined)
    router.register('list', handler)
    await router.dispatch('ls', vi.fn())
    expect(handler).toHaveBeenCalled()
  })
})
