type Value = Record<string, any>;

const PRIVATE_KEY = /(api[_-]?key|authorization|password|secret|token|cookie)/i;

export function redactDebugValue(value: any, key = ""): any {
  if (PRIVATE_KEY.test(key)) return "••••••";
  if (Array.isArray(value)) return value.map((item) => redactDebugValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, redactDebugValue(child, childKey)]),
    );
  }
  return value;
}

export function jobDebugParameters(input: Value = {}): Value {
  const { prompt: _prompt, system_prompt: _systemPrompt, ...parameters } = input;
  return redactDebugValue(parameters);
}

export function jobElapsedSeconds(job: Value, now = Date.now() / 1000): number {
  const start = Number(job.started || job.created || now);
  const end = Number(job.finished || (["queued", "running"].includes(job.status) ? now : job.updated) || start);
  return Math.max(0, end - start);
}

export function taskDetailHref(jobId: string): string {
  return `/?task=${encodeURIComponent(jobId)}`;
}
