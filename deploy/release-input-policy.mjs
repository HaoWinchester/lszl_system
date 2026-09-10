// Operational records and the generated sync diff are not validation inputs.
// Source, site, and manifest contents remain independently fingerprinted.
// Other docs may be read by contract tests; scripts and unknown paths fail closed.
export function isOperationalRecord(path) {
  return path === 'frontend/new-legacy-sync-report.json'
    || (path.endsWith('.md')
      && (path.startsWith('docs/superpowers/') || path.startsWith('docs/verification/')))
}
