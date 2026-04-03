import chalk from 'chalk'
import ora from 'ora'

export const ui = {
  step: (n: number, text: string) =>
    console.log(chalk.bold.cyan(`\nStep ${n}: ${text}`)),

  success: (text: string) =>
    console.log(chalk.green('✓ ') + text),

  error: (text: string) =>
    console.error(chalk.red('✗ ') + text),

  info: (text: string) =>
    console.log(chalk.grey('  ') + text),

  warn: (text: string) =>
    console.log(chalk.yellow('⚠ ') + text),

  header: (text: string) =>
    console.log('\n' + chalk.bold.white(text) + '\n'),

  spinner: (text: string) => ora({ text, color: 'cyan' }),
}
