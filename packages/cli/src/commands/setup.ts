import { input, select, confirm } from '@inquirer/prompts'
import { execa } from 'execa'
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { ui } from '../ui.js'
import { detectMultiplexers, installInstructions } from '../detector.js'
import { validateBotToken, validateAppToken, validateChannel } from '../validator.js'
import { getSecret, setSecret } from '../keychain.js'
import { install, resolveNodePath } from '../launchagent.js'
import { writeConfig, readConfig, CONFIG_DIR } from '@perch-dev/shared/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SLACK_MANIFEST = readFileSync(join(__dirname, '../../../slack/manifest.json'), 'utf-8')

const CMUX_BIN =
  process.env.CMUX_BIN ??
  '/Applications/cmux.app/Contents/Resources/bin/cmux'

const CMUX_SOCKET =
  process.env.CMUX_SOCKET_PATH ??
  join(homedir(), 'Library', 'Application Support', 'cmux', 'cmux.sock')

async function validateCmuxConnection(): Promise<boolean> {
  try {
    await execa(CMUX_BIN, ['ping'], {
      env: { ...process.env, CMUX_SOCKET_PATH: CMUX_SOCKET },
    })
    return true
  } catch {
    return false
  }
}

const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json')
const CLAUDE_SKILLS_DIR = join(homedir(), '.claude', 'skills')
const HOOKS_DIR = join(CONFIG_DIR, 'hooks')
const WAITING_DIR = join(CONFIG_DIR, 'waiting')
const PERCH_HOOK_MARKER = 'perch-managed'

/** Bundled skill sources (relative to CLI package). */
const SKILL_SOURCES = join(__dirname, '../../../skills')

/** Source hook scripts (relative to CLI package). */
const HOOK_SOURCES = join(__dirname, '../../../hooks')

function perchHookEntries(): Record<string, Array<Record<string, unknown>>> {
  const stateHook = (event: string, opts?: { timeout?: number; async?: boolean }) => ({
    type: 'command',
    command: `sh "${join(HOOKS_DIR, 'state-hook.sh')}" ${event}`,
    timeout: opts?.timeout ?? 5,
    ...(opts?.async ? { async: true } : {}),
    _perch: PERCH_HOOK_MARKER,
  })

  return {
    PreToolUse: [
      {
        matcher: 'ExitPlanMode',
        hooks: [{
          type: 'command',
          command: `sh "${join(HOOKS_DIR, 'pre-tool-use.sh')}"`,
          timeout: 120,
          _perch: PERCH_HOOK_MARKER,
        }],
      },
      {
        matcher: '',
        hooks: [stateHook('pre-tool-use', { async: true })],
      },
    ],
    PermissionRequest: [{
      matcher: '',
      hooks: [{
        type: 'command',
        command: `sh "${join(HOOKS_DIR, 'permission-request.sh')}"`,
        timeout: 5,
        _perch: PERCH_HOOK_MARKER,
      }],
    }],
    PostToolUse: [{
      matcher: '',
      hooks: [{
        type: 'command',
        command: `sh "${join(HOOKS_DIR, 'post-tool-use.sh')}"`,
        timeout: 5,
        _perch: PERCH_HOOK_MARKER,
      }],
    }],
    PostToolUseFailure: [{
      matcher: '',
      hooks: [{
        type: 'command',
        command: `sh "${join(HOOKS_DIR, 'post-tool-use.sh')}"`,
        timeout: 5,
        _perch: PERCH_HOOK_MARKER,
      }],
    }],
    Stop: [{
      matcher: '',
      hooks: [stateHook('stop')],
    }],
    UserPromptSubmit: [{
      matcher: '',
      hooks: [stateHook('prompt-submit')],
    }],
    Notification: [{
      matcher: '',
      hooks: [stateHook('notification')],
    }],
  }
}

function isPerchHookEntry(entry: Record<string, unknown>): boolean {
  const hooks = entry.hooks as Array<Record<string, unknown>> | undefined
  return hooks?.some(h => h._perch === PERCH_HOOK_MARKER) ?? false
}

async function installClaudeHooks(): Promise<void> {
  // Copy hook scripts to ~/.config/perch/hooks/
  mkdirSync(HOOKS_DIR, { recursive: true })
  mkdirSync(WAITING_DIR, { recursive: true })
  for (const name of ['permission-request.sh', 'post-tool-use.sh', 'pre-tool-use.sh', 'state-hook.sh']) {
    const src = join(HOOK_SOURCES, name)
    const dst = join(HOOKS_DIR, name)
    writeFileSync(dst, readFileSync(src, 'utf-8'), { mode: 0o755 })
  }

  // Register hooks in ~/.claude/settings.json
  let settings: Record<string, unknown> = {}
  if (existsSync(CLAUDE_SETTINGS_PATH)) {
    settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'))
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>
  for (const [hookName, hookEntries] of Object.entries(perchHookEntries())) {
    const existing = (hooks[hookName] ?? []) as Array<Record<string, unknown>>
    const cleaned = existing.filter(entry => !isPerchHookEntry(entry))
    hooks[hookName] = [...cleaned, ...hookEntries]
  }

  settings.hooks = hooks
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}

function installClaudeSkill(skillName: string): void {
  const src = join(SKILL_SOURCES, skillName)
  const dst = join(CLAUDE_SKILLS_DIR, skillName)
  mkdirSync(dst, { recursive: true })
  cpSync(src, dst, { recursive: true })
}

const PERCH_SKILLS = ['cmux'] as const

export function removeClaudeSkills(): void {
  for (const skillName of PERCH_SKILLS) {
    const dst = join(CLAUDE_SKILLS_DIR, skillName)
    if (existsSync(dst)) {
      rmSync(dst, { recursive: true })
    }
  }
}

export function removeClaudeHooks(): void {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return
  try {
    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8')) as Record<string, unknown>
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>
    let changed = false
    for (const hookName of Object.keys(perchHookEntries())) {
      const existing = (hooks[hookName] ?? []) as Array<Record<string, unknown>>
      const cleaned = existing.filter(entry => !isPerchHookEntry(entry))
      if (cleaned.length !== existing.length) {
        hooks[hookName] = cleaned
        changed = true
      }
    }
    if (changed) {
      settings.hooks = hooks
      writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
    }
  } catch {
    // best effort
  }
}

export async function runSetup(): Promise<void> {
  ui.header('Welcome to Perch Setup')

  // Step 1: Detect multiplexer
  ui.step(1, 'Detecting terminal multiplexer')
  const found = await detectMultiplexers()

  if (found.length === 0) {
    ui.error('No supported terminal multiplexer found.')
    ui.info(`Install tmux: ${installInstructions('tmux')}`)
    process.exit(1)
  }

  let multiplexerId: string
  if (found.length === 1) {
    multiplexerId = found[0]!.id
    ui.success(`Found ${found[0]!.displayName}`)
  } else {
    multiplexerId = await select({
      message: `Found ${found.map(m => m.displayName).join(' and ')}. Which do you want to use?`,
      choices: found.map(m => ({ name: m.displayName, value: m.id })),
    })
  }

  // Validate cmux Automation Mode (required for CLI to work from background processes)
  if (multiplexerId === 'cmux') {
    while (true) {
      const spinner = ui.spinner('Testing cmux socket connection...').start()
      const ok = await validateCmuxConnection()
      if (ok) {
        spinner.succeed('cmux connected')
        break
      }
      spinner.fail('cmux CLI cannot reach the socket')
      ui.info('\nPerch requires cmux Automation Mode to be enabled:')
      ui.info('  cmux → Settings → Automation → Socket Control Mode: Automation')
      await input({ message: 'Press Enter once you have enabled Automation Mode...' })
    }
  }

  // Step 2: Slack app creation
  ui.step(2, 'Slack app creation')
  ui.info('Open this URL to import the Slack app manifest:')
  ui.info('  https://api.slack.com/apps?new_app=1')
  ui.info('\nPaste this manifest:\n')
  console.log(SLACK_MANIFEST)
  await input({ message: 'Press Enter once your app is created...' })

  // Step 3: Token collection
  ui.step(3, 'Token collection')

  let botToken = await getSecret('botToken') ?? ''
  if (botToken) {
    ui.success('Bot token found in Keychain')
  } else {
    while (true) {
      botToken = await input({ message: 'Paste your Bot Token (xoxb-...):' })
      const spinner = ui.spinner('Validating bot token...').start()
      const result = await validateBotToken(botToken)
      if (result.ok) { spinner.succeed('Bot token valid'); break }
      spinner.fail(`Invalid: ${result.error}`)
    }
    await setSecret('botToken', botToken)
  }

  let appToken = await getSecret('appToken') ?? ''
  if (appToken) {
    ui.success('App token found in Keychain')
  } else {
    while (true) {
      appToken = await input({ message: 'Paste your App Token (xapp-...):' })
      const spinner = ui.spinner('Validating app token...').start()
      const result = await validateAppToken(appToken)
      if (result.ok) { spinner.succeed('App token valid'); break }
      spinner.fail(`Invalid: ${result.error}`)
    }
    await setSecret('appToken', appToken)
  }

  // Step 4: Channel setup
  ui.step(4, 'Channel setup')
  const existingChannel = readConfig().slackChannelId
  let channelId = ''
  while (true) {
    const prompt = existingChannel
      ? `Slack Channel ID (Enter to keep ${existingChannel}):`
      : 'Paste the Slack Channel ID where Perch should listen:'
    const raw = await input({ message: prompt })
    channelId = raw.trim() || existingChannel
    if (!channelId) { ui.error('Channel ID is required.'); continue }
    const spinner = ui.spinner('Testing channel access...').start()
    const result = await validateChannel(botToken, channelId)
    if (result.ok) { spinner.succeed('Channel access confirmed'); break }
    spinner.fail(`Cannot post to channel: ${result.error}`)
  }

  const config = readConfig()
  writeConfig({ ...config, slackChannelId: channelId, adapterPriority: [multiplexerId, ...config.adapterPriority.filter(a => a !== multiplexerId)] })

  // Step 5: Claude Code hooks
  ui.step(5, 'Installing Claude Code hooks')
  const hooksSpinner = ui.spinner('Configuring Claude Code hooks...').start()
  try {
    await installClaudeHooks()
    hooksSpinner.succeed('Claude Code hooks installed')
  } catch (err) {
    hooksSpinner.fail(`Could not install Claude Code hooks: ${err instanceof Error ? err.message : err}`)
    ui.info('  Perch will still work, but won\'t detect permission prompts.')
  }

  // Step 6: Claude Code skills (adapter-specific)
  if (multiplexerId === 'cmux') {
    ui.step(6, 'Installing cmux skill for Claude Code')
    const skillSpinner = ui.spinner('Installing cmux skill...').start()
    try {
      installClaudeSkill('cmux')
      skillSpinner.succeed('cmux skill installed → ~/.claude/skills/cmux/')
    } catch (err) {
      skillSpinner.fail(`Could not install cmux skill: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Step 7: LaunchAgent install
  ui.step(7, 'Installing LaunchAgent')
  const nodePath = await resolveNodePath()
  const daemonPath = join(__dirname, '../../daemon/dist/index.js')

  const spinner = ui.spinner('Installing LaunchAgent...').start()
  await install({ nodePath, daemonPath })
  spinner.succeed('LaunchAgent installed and started')

  // Step 8: Summary
  ui.header('Setup Complete!')
  ui.success(`Multiplexer: ${multiplexerId}`)
  ui.success(`Channel: ${channelId}`)
  ui.success('Perch is running and will restart automatically on login.')
  ui.info('\nManage Perch:')
  ui.info('  perch status   — Check daemon status')
  ui.info('  perch logs     — Tail daemon logs')
  ui.info('  perch restart  — Restart the daemon')
  ui.info('  perch uninstall — Remove Perch')
}
