import { WebClient } from '@slack/web-api'

export interface ValidationResult {
  ok: boolean
  error?: string
}

export async function validateBotToken(token: string): Promise<ValidationResult> {
  try {
    const client = new WebClient(token)
    const res = await client.auth.test()
    if (!res.ok) return { ok: false, error: 'auth.test returned not ok' }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function validateAppToken(token: string): Promise<ValidationResult> {
  // App tokens (xapp-) cannot call auth.test; validate format only
  if (!token.startsWith('xapp-')) {
    return { ok: false, error: 'App token must start with xapp-' }
  }
  return { ok: true }
}

export async function validateChannel(
  botToken: string,
  channelId: string,
): Promise<ValidationResult> {
  try {
    const client = new WebClient(botToken)
    const res = await client.chat.postMessage({
      channel: channelId,
      text: ':wave: Perch is connected. Type `help` to get started.',
    })
    if (!res.ok) return { ok: false, error: 'Could not post to channel' }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
