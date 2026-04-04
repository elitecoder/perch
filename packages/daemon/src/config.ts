export {
  CONFIG_DIR,
  CONFIG_PATH,
  STATE_PATH,
  LOG_PATH,
  LOCK_PATH,
  ensureConfigDir,
  readConfig,
  writeConfig,
  readState,
  writeState,
} from '@perch-dev/shared/config'

export type { PerchConfig, PerchState } from '@perch-dev/shared/config'
