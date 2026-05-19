const LOG_LEVELS = { info: "INFO", warn: "WARN", error: "ERROR" };

function timestamp() {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function log(level, msg) {
  process.stderr.write(`[${timestamp()} ${LOG_LEVELS[level] || level}] ${msg}\n`);
}

export const guohub_logger = {
  info: (msg) => log("info", msg),
  warn: (msg) => log("warn", msg),
  error: (msg) => log("error", msg),
};

export function guohub_json_print(data) {
  process.stdout.write(JSON.stringify(data) + "\n");
  process.exit(0);
}

export function guohub_text_print(text) {
  process.stdout.write(text + "\n");
  process.exit(0);
}

export function guohub_success_print() {
  process.stdout.write(JSON.stringify({ is_success: true }) + "\n");
  process.exit(0);
}

export function guohub_error_print(errorInfo) {
  process.stdout.write(JSON.stringify({ error_info: String(errorInfo) }) + "\n");
  process.exit(1);
}
