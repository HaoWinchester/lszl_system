export function avatarLetterOf(displayName?: string | null, username?: string | null): string {
  const source = String(displayName || username || '').trim();
  return (Array.from(source)[0] || '学').toUpperCase();
}
