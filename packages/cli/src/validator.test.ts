import { describe, expect, it, vi } from 'vitest'
import { validateBotToken, validateAppToken, validateChannel } from './validator.js'

vi.mock('@slack/web-api', () => {
  const WebClient = vi.fn().mockImplementation(() => ({
    auth: {
      test: vi.fn().mockResolvedValue({ ok: true }),
    },
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true }),
    },
  }))
  return { default: { WebClient }, WebClient }
})

import webApi from '@slack/web-api'
const MockWebClient = vi.mocked(webApi.WebClient)

describe('validateBotToken', () => {
  it('returns ok=true when auth.test succeeds', async () => {
    const result = await validateBotToken('xoxb-valid')
    expect(result.ok).toBe(true)
  })

  it('returns ok=false when auth.test throws', async () => {
    MockWebClient.mockImplementationOnce(() => ({
      auth: { test: vi.fn().mockRejectedValue(new Error('invalid_auth')) },
    }) as never)
    const result = await validateBotToken('xoxb-bad')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('invalid_auth')
  })

  it('returns ok=false when auth.test returns not ok', async () => {
    MockWebClient.mockImplementationOnce(() => ({
      auth: { test: vi.fn().mockResolvedValue({ ok: false }) },
    }) as never)
    const result = await validateBotToken('xoxb-bad')
    expect(result.ok).toBe(false)
  })
})

describe('validateAppToken', () => {
  it('returns ok=true for valid xapp- prefix', async () => {
    const result = await validateAppToken('xapp-valid-token')
    expect(result.ok).toBe(true)
  })

  it('returns ok=false for wrong prefix', async () => {
    const result = await validateAppToken('xoxb-wrong')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('xapp-')
  })
})

describe('validateChannel', () => {
  it('returns ok=true when bot can post', async () => {
    const result = await validateChannel('xoxb-valid', 'C0TEST')
    expect(result.ok).toBe(true)
  })

  it('returns ok=false when posting throws', async () => {
    MockWebClient.mockImplementationOnce(() => ({
      auth: { test: vi.fn() },
      chat: { postMessage: vi.fn().mockRejectedValue(new Error('channel_not_found')) },
    }) as never)
    const result = await validateChannel('xoxb-valid', 'C0BAD')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('channel_not_found')
  })
})
