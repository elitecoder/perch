import { describe, expect, it, vi } from 'vitest'
import { setSecret, getSecret, deleteSecret, clearAllSecrets } from './keychain.js'

vi.mock('keytar', () => ({
  default: {
    setPassword: vi.fn().mockResolvedValue(undefined),
    getPassword: vi.fn().mockResolvedValue('stored-value'),
    deletePassword: vi.fn().mockResolvedValue(true),
  },
}))

import keytar from 'keytar'
const mockKeytar = vi.mocked(keytar)

describe('keychain', () => {
  describe('setSecret', () => {
    it('calls keytar.setPassword with correct service and key', async () => {
      await setSecret('botToken', 'xoxb-test')
      expect(mockKeytar.setPassword).toHaveBeenCalledWith('dev.perch', 'botToken', 'xoxb-test')
    })
  })

  describe('getSecret', () => {
    it('returns the stored value', async () => {
      const val = await getSecret('botToken')
      expect(val).toBe('stored-value')
      expect(mockKeytar.getPassword).toHaveBeenCalledWith('dev.perch', 'botToken')
    })
  })

  describe('deleteSecret', () => {
    it('calls keytar.deletePassword with correct service and key', async () => {
      await deleteSecret('appToken')
      expect(mockKeytar.deletePassword).toHaveBeenCalledWith('dev.perch', 'appToken')
    })
  })

  describe('clearAllSecrets', () => {
    it('deletes both botToken and appToken', async () => {
      await clearAllSecrets()
      expect(mockKeytar.deletePassword).toHaveBeenCalledWith('dev.perch', 'botToken')
      expect(mockKeytar.deletePassword).toHaveBeenCalledWith('dev.perch', 'appToken')
    })
  })
})
