import chalk from 'chalk';
import ora from 'ora';

const spinners = new Map();

export const logger = {
  info: (msg) => {
    console.log(chalk.cyan('ℹ ') + chalk.white(msg));
  },
  success: (msg) => {
    console.log(chalk.green('✔ ') + chalk.greenBright(msg));
  },
  warn: (msg) => {
    console.log(chalk.yellow('⚠ ') + chalk.yellowBright(msg));
  },
  error: (msg) => {
    console.log(chalk.red('✖ ') + chalk.redBright.bold(msg));
  },
  box: (title, msg, color = 'cyan') => {
    const boxColor = chalk[color] || chalk.cyan;
    console.log(boxColor('╭' + '─'.repeat(title.length + 2) + '╮'));
    console.log(boxColor('│ ') + chalk.bold(title) + boxColor(' │'));
    console.log(boxColor('├' + '─'.repeat(title.length + 2) + '┤'));
    console.log(boxColor('│ ') + chalk.white(msg));
    console.log(boxColor('╰' + '─'.repeat(title.length + 2) + '╯'));
  },
  startSpinner: (id, text) => {
    if (spinners.has(id)) {
      spinners.get(id).text = text;
    } else {
      const spinner = ora({
        text,
        color: 'cyan',
        spinner: 'dots'
      }).start();
      spinners.set(id, spinner);
    }
  },
  succeedSpinner: (id, text) => {
    if (spinners.has(id)) {
      spinners.get(id).succeed(text);
      spinners.delete(id);
    }
  },
  failSpinner: (id, text) => {
    if (spinners.has(id)) {
      spinners.get(id).fail(text);
      spinners.delete(id);
    }
  },
  printAsciiArt: () => {
    console.log(chalk.magentaBright(`
    ╔╦╗╔═╗╔╦╗╔═╗╔═╗╔═╗╦╔╗╔
    ║║║║╣ ║║║║╣ ║  ║ ║║║║║
    ╩ ╩╚═╝╩ ╩╚═╝╚═╝╚═╝╩╝╚╝
      AI TRADING V3 - ONLINE
    `));
  }
};
