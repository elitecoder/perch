import { describe, expect, it } from 'vitest'
import { encodeCwdPath } from './resolver.js'

describe('encodeCwdPath', () => {
  it('encodes a simple path (leading slash becomes leading dash)', () => {
    expect(encodeCwdPath('/Users/mukul/dev/perch')).toBe('-Users-mukul-dev-perch')
  })

  it('handles root path', () => {
    expect(encodeCwdPath('/tmp')).toBe('-tmp')
  })

  it('encodes deeply nested path', () => {
    expect(encodeCwdPath('/home/user/projects/my-app')).toBe('-home-user-projects-my-app')
  })

  it('matches the actual project directory name on this machine', () => {
    // ~/.claude/projects/-Users-mukulsharma-dev-perch/ is the real directory
    expect(encodeCwdPath('/Users/mukulsharma/dev/perch')).toBe('-Users-mukulsharma-dev-perch')
  })
})
