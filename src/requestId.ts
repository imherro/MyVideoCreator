export function requestId(prefix = "") {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return prefix + Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  }
  return prefix + Date.now().toString(16) + Math.random().toString(16).slice(2).padEnd(16, "0");
}
