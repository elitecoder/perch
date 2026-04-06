import { input, select, confirm } from '@inquirer/prompts'
import { execa } from 'execa'
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { ui } from '../ui.js'
import { detectMultiplexers, installInstructions, detectClaudeCode } from '../detector.js'
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

const CMUX_BUNDLE_ID = 'com.cmuxterm.app'

async function getCmuxSocketControlMode(): Promise<string | null> {
  try {
    const { stdout } = await execa('defaults', ['read', CMUX_BUNDLE_ID, 'socketControlMode'])
    return stdout.trim()
  } catch {
    return null
  }
}

async function enableCmuxAutomationMode(): Promise<void> {
  await execa('defaults', ['write', CMUX_BUNDLE_ID, 'socketControlMode', '-string', 'automation'])
}

async function isCmuxRunning(): Promise<boolean> {
  try {
    const { stdout } = await execa('pgrep', ['-x', 'cmux'])
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function launchCmux(): Promise<void> {
  await execa('open', ['-a', 'cmux'])
}

/** Wait for cmux socket to become reachable, up to maxWaitMs. */
async function waitForCmuxSocket(maxWaitMs = 10_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    if (await validateCmuxConnection()) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
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
          timeout: 5,
          _perch: PERCH_HOOK_MARKER,
        }],
      },
      {
        matcher: 'AskUserQuestion',
        hooks: [{
          type: 'command',
          command: `sh "${join(HOOKS_DIR, 'pre-tool-use.sh')}"`,
          timeout: 5,
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
    Notification: [
      {
        matcher: 'permission_prompt',
        hooks: [{
          type: 'command',
          command: `sh "${join(HOOKS_DIR, 'notification-hook.sh')}"`,
          timeout: 5,
          _perch: PERCH_HOOK_MARKER,
        }],
      },
      {
        matcher: 'idle_prompt',
        hooks: [{
          type: 'command',
          command: `sh "${join(HOOKS_DIR, 'notification-hook.sh')}"`,
          timeout: 5,
          _perch: PERCH_HOOK_MARKER,
        }],
      },
      {
        matcher: 'elicitation_dialog',
        hooks: [{
          type: 'command',
          command: `sh "${join(HOOKS_DIR, 'notification-hook.sh')}"`,
          timeout: 5,
          _perch: PERCH_HOOK_MARKER,
        }],
      },
      {
        matcher: '',
        hooks: [stateHook('notification', { async: true })],
      },
    ],
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
  for (const name of ['permission-request.sh', 'post-tool-use.sh', 'pre-tool-use.sh', 'state-hook.sh', 'notification-hook.sh']) {
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

  // Step 0: Check Claude Code is installed
  ui.step(0, 'Checking Claude Code')
  const claudeSpinner = ui.spinner('Detecting Claude Code...').start()
  const claude = await detectClaudeCode()
  if (!claude.installed) {
    claudeSpinner.fail('Claude Code not found')
    ui.info('\nPerch requires Claude Code to be installed.')
    ui.info('  npm install -g @anthropic-ai/claude-code')
    ui.info('\nRun `perch setup` again after installing.')
    process.exit(1)
  }
  claudeSpinner.succeed(`Claude Code ${claude.version ?? ''} installed`)

  // Step 1: Detect multiplexer
  ui.step(1, 'Detecting terminal multiplexer')
  let found = await detectMultiplexers()

  if (found.length === 0) {
    // Offer to install cmux via Homebrew
    const installCmux = await confirm({ message: 'No terminal multiplexer found. Install cmux via Homebrew?' })
    if (installCmux) {
      const installSpinner = ui.spinner('Installing cmux (brew install --cask cmux)...').start()
      try {
        await execa('brew', ['install', '--cask', 'cmux'], { timeout: 120_000 })
        installSpinner.succeed('cmux installed')
        // Enable Automation Mode before first launch so the socket is available immediately
        await enableCmuxAutomationMode()
        ui.success('Automation Mode enabled')
        // Launch the app
        const launchSpinner = ui.spinner('Launching cmux...').start()
        await launchCmux()
        const socketReady = await waitForCmuxSocket()
        if (socketReady) {
          launchSpinner.succeed('cmux launched and socket ready')
        } else {
          launchSpinner.warn('cmux launched but socket not yet ready — will retry later')
        }
        found = await detectMultiplexers()
      } catch (err) {
        installSpinner.fail(`Installation failed: ${err instanceof Error ? err.message : err}`)
      }
    }
    if (found.length === 0) {
      ui.error('No supported terminal multiplexer found.')
      ui.info(`Install cmux:  brew install --cask cmux`)
      ui.info(`Install tmux:  ${installInstructions('tmux')}`)
      process.exit(1)
    }
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
    // Check if Automation Mode is already enabled
    const currentMode = await getCmuxSocketControlMode()
    if (currentMode !== 'automation') {
      const enableAuto = await confirm({ message: 'Perch requires cmux Automation Mode. Enable it now?' })
      if (enableAuto) {
        const autoSpinner = ui.spinner('Enabling Automation Mode...').start()
        try {
          await enableCmuxAutomationMode()
          autoSpinner.succeed('Automation Mode enabled')
          if (await isCmuxRunning()) {
            // cmux needs a restart to pick up the defaults change
            const restartSpinner = ui.spinner('Restarting cmux to apply setting...').start()
            await execa('osascript', ['-e', 'tell application "cmux" to quit'])
            await new Promise(r => setTimeout(r, 1000))
            await launchCmux()
            const ready = await waitForCmuxSocket()
            if (ready) {
              restartSpinner.succeed('cmux restarted')
            } else {
              restartSpinner.warn('cmux restarted but socket not yet ready')
            }
          }
        } catch (err) {
          autoSpinner.fail(`Could not enable Automation Mode: ${err instanceof Error ? err.message : err}`)
          ui.info('  Enable manually: cmux → Settings → Automation → Socket Control Mode: Automation')
          await input({ message: 'Press Enter once you have enabled Automation Mode...' })
        }
      } else {
        ui.info('  Enable manually: cmux → Settings → Automation → Socket Control Mode: Automation')
        await input({ message: 'Press Enter once you have enabled Automation Mode...' })
      }
    }

    // Ensure cmux is running
    if (!(await isCmuxRunning())) {
      const launchSpinner = ui.spinner('Launching cmux...').start()
      await launchCmux()
      const socketReady = await waitForCmuxSocket()
      if (socketReady) {
        launchSpinner.succeed('cmux launched')
      } else {
        launchSpinner.fail('cmux launched but socket not ready')
      }
    }

    // Verify socket connection works
    const connSpinner = ui.spinner('Testing cmux socket connection...').start()
    const ok = await validateCmuxConnection()
    if (ok) {
      connSpinner.succeed('cmux connected')
    } else {
      connSpinner.fail('cmux CLI cannot reach the socket')
      ui.info('\nMake sure cmux is running with Automation Mode enabled, then try again.')
      ui.info('  cmux → Settings → Automation → Socket Control Mode: Automation')
      process.exit(1)
    }
  }

  // Step 2: Slack app setup
  ui.step(2, 'Slack app setup')

  let botToken = await getSecret('botToken') ?? ''
  let appToken = await getSecret('appToken') ?? ''

  if (botToken && appToken) {
    ui.success('Slack tokens found in Keychain')
  } else {
    const hasExisting = await confirm({
      message: 'Does someone on your team already have a Perch Slack app installed?',
      default: false,
    })

    if (hasExisting) {
      ui.info('\nAsk your teammate for the Bot Token and App Token from the existing Perch app.')
      ui.info('They can find them at: https://api.slack.com/apps → select Perch')
      ui.info('  Bot Token:  OAuth & Permissions → Bot User OAuth Token (xoxb-...)')
      ui.info('  App Token:  Basic Information → App-Level Tokens (xapp-...)')
    } else {
      ui.info('\nCreate a new Slack app for Perch:\n')
      ui.info('  1. Open: https://api.slack.com/apps?new_app=1')
      ui.info('  2. Choose "From a manifest" → select your workspace')
      ui.info('  3. Switch to JSON tab and paste this manifest:\n')
      console.log(SLACK_MANIFEST)
      ui.info('\n  4. Click "Create" to create the app')
      ui.info('  5. Click "Install to Workspace" and authorize')
      await input({ message: 'Press Enter once the app is installed to your workspace...' })

      ui.info('\nCopy the Bot Token:')
      ui.info('  App page → OAuth & Permissions → Bot User OAuth Token (starts with xoxb-)')
    }

    if (!botToken) {
      while (true) {
        botToken = await input({ message: 'Paste your Bot Token (xoxb-...):' })
        const spinner = ui.spinner('Validating bot token...').start()
        const result = await validateBotToken(botToken)
        if (result.ok) { spinner.succeed('Bot token valid'); break }
        spinner.fail(`Invalid: ${result.error}`)
      }
      await setSecret('botToken', botToken)
    }

    if (!appToken) {
      if (!hasExisting) {
        ui.info('\nGenerate an App-Level Token:')
        ui.info('  App page → Basic Information → scroll to "App-Level Tokens" → Generate Token')
        ui.info('  Name it anything (e.g. "perch"), add scope: connections:write, then Generate')
      }
      while (true) {
        appToken = await input({ message: 'Paste your App Token (xapp-...):' })
        const spinner = ui.spinner('Validating app token...').start()
        const result = await validateAppToken(appToken)
        if (result.ok) { spinner.succeed('App token valid'); break }
        spinner.fail(`Invalid: ${result.error}`)
      }
      await setSecret('appToken', appToken)
    }
  }

  // Step 3: Channel setup
  ui.step(3, 'Channel setup')
  ui.info('Create or pick a Slack channel for Perch, then find its ID:')
  ui.info('  Open the channel → click the channel name at top → scroll to bottom')
  ui.info('  The Channel ID looks like C07XXXXXX')
  ui.info('\nMake sure to invite the Perch bot to the channel: /invite @Perch')
  const existingChannel = readConfig().slackChannelId
  let channelId = ''
  while (true) {
    const prompt = existingChannel
      ? `Slack Channel ID (Enter to keep ${existingChannel}):`
      : 'Paste the Slack Channel ID:'
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
