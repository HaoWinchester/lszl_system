// Only human-readable operational records are outside release validation inputs.
// Other docs may be read by contract tests; scripts and unknown paths fail closed.
export function isOperationalRecord(path) {
  return path.endsWith('.md')
    && (path.startsWith('docs/superpowers/') || path.startsWith('docs/verification/'))
}
