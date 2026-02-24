const URL_PATTERN = /^https?:\/\//i
const BARE_DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+([/?#]|$)/i

export function isUrlValue(value: string): boolean {
  if (!value) return false
  return URL_PATTERN.test(value) || BARE_DOMAIN_PATTERN.test(value)
}

export function normalizeUrl(url: string): string {
  if (URL_PATTERN.test(url)) return url
  return `https://${url}`
}
