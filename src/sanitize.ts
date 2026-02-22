/**
 * Sanitize folder names to prevent path traversal attacks.
 * Only allows alphanumerics, hyphens, and underscores.
 */
export function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-') // Only allow safe chars
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-+|-+$/g, '') // Trim hyphens from start/end
    .slice(0, 100) // Limit length to prevent overflow
    || 'unnamed'; // Fallback if result is empty
}
