export function redactSecrets(text = "") {
  return String(text)
    .replace(
      /^([+\-\s]*(?:set\s+|export\s+)?[A-Z0-9_]*(?:API|AUTH|ACCESS|SECRET|TOKEN|KEY|PASSWORD|PASS|PRIVATE|CREDENTIAL|SIGN(?:ING)?)[A-Z0-9_]*\s*=\s*)(.+)$/gim,
      "$1[REDACTED]",
    )
    .replace(/(Authorization:\s*Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(["'](?:api[_-]?(?:key|secret|token)|apiKey|apiSecret|access[_-]?token|accessToken|secret[_-]?key|secretKey|private[_-]?key|privateKey|signing[_-]?key|signingKey)["']\s*:\s*["'])[^"']+/gi, "$1[REDACTED]")
    .replace(/(\b(?:token|apiKey|apiSecret|accessToken|secretKey|privateKey)\s*[:=]\s*["'])[^"']+/gi, "$1[REDACTED]")
    .replace(/(--(?:api[_-]?key|api[_-]?secret|access[_-]?token|token))(\s+|=)\s*(?:"[^"]*"|'[^']*'|[^\s"']+)/gi, "$1$2[REDACTED]");
}
