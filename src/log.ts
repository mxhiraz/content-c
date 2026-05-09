const colors = {
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  bold: "\x1b[1m",
};

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function tag(scope: string, color: keyof typeof colors): string {
  return `${colors.dim}${ts()}${colors.reset} ${colors[color]}[${scope}]${colors.reset}`;
}

export const log = {
  info(scope: string, msg: string): void {
    console.log(`${tag(scope, "cyan")} ${msg}`);
  },
  step(scope: string, msg: string): void {
    console.log(`${tag(scope, "blue")} ${colors.bold}${msg}${colors.reset}`);
  },
  ok(scope: string, msg: string): void {
    console.log(`${tag(scope, "green")} ${msg}`);
  },
  warn(scope: string, msg: string): void {
    console.log(`${tag(scope, "yellow")} ${msg}`);
  },
  err(scope: string, msg: string): void {
    console.log(`${tag(scope, "red")} ${msg}`);
  },
  tool(scope: string, msg: string): void {
    console.log(`${tag(scope, "magenta")} ${msg}`);
  },
  raw(s: string): void {
    process.stdout.write(s);
  },
  newline(): void {
    process.stdout.write("\n");
  },
  dim(s: string): string {
    return `${colors.dim}${s}${colors.reset}`;
  },
};
