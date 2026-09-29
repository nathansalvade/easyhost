export const APP_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;

export function suggestName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+|[-_.]+$/g, '')
    .slice(0, 63);
}

export function nameProblem(name: string): string | null {
  if (!name) return 'Give the app a name.';
  if (!APP_NAME_PATTERN.test(name)) {
    return 'Use letters, numbers, dots, dashes or underscores, starting with a letter or number (no spaces).';
  }
  return null;
}
