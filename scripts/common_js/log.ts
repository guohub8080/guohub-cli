function formatTime(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const guohub_logger = {
  info(msg: string) {
    process.stderr.write(`[${formatTime()} INFO] ${msg}\n`);
  },
};

export function guohub_json_print(data: unknown): never {
  console.log(JSON.stringify(data));
  process.exit(0);
}

export function guohub_error_print(error_info: string): never {
  console.log(JSON.stringify({ error_info }));
  process.exit(1);
}

export function guohub_text_print(text: string): never {
  console.log(text);
  process.exit(0);
}

export function guohub_success_print(): never {
  console.log(JSON.stringify({ is_success: true }));
  process.exit(0);
}
