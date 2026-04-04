import { input, select, confirm } from '@inquirer/prompts'
import { execa } from 'execa'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { ui } from '../ui.js'
import { detectMultiplexers, installInstructions } from '../detector.js'
import { validateBotToken, validateAppToken, validateChannel } from '../validator.js'
import { getSecret, setSecret } from '../keychain.js'
import { install, resolveNodePath } from '../launchagent.js'
import { writeConfig, readConfig } from '@perch-dev/shared/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SLACK_MANIFEST = JSON.stringify({
  display_information: { name: 'Perch', description: 'Remote control your terminal sessions from Slack', background_color: '#1a1a2e' },
  settings: {
    socket_mode_enabled: true,
    org_deploy_enabled: false,
    is_hosted: false,
    token_rotation_enabled: false,
    event_subscriptions: {
      bot_events: ['message.channels', 'message.groups', 'message.im', 'app_mention'],
    },
  },
  oauth_config: { scopes: { bot: ['app_mentions:read', 'chat:write', 'channels:read', 'groups:read', 'channels:history', 'groups:history', 'im:history', 'im:read', 'im:write'] } },
  features: { bot_user: { display_name: 'perch', always_online: false } },
}, null, 2)

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
  let channelId = ''
  while (true) {
    channelId = await input({ message: 'Paste the Slack Channel ID where Perch should listen:' })
    const spinner = ui.spinner('Testing channel access...').start()
    const result = await validateChannel(botToken, channelId)
    if (result.ok) { spinner.succeed('Channel access confirmed'); break }
    spinner.fail(`Cannot post to channel: ${result.error}`)
  }

  const config = readConfig()
  writeConfig({ ...config, slackChannelId: channelId, adapterPriority: [multiplexerId, ...config.adapterPriority.filter(a => a !== multiplexerId)] })

  // Step 5: LaunchAgent install
  ui.step(5, 'Installing LaunchAgent')
  const nodePath = await resolveNodePath()
  const daemonPath = join(__dirname, '../../daemon/dist/index.js')

  const spinner = ui.spinner('Installing LaunchAgent...').start()
  await install({ nodePath, daemonPath })
  spinner.succeed('LaunchAgent installed and started')

  // Step 6: Summary
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
