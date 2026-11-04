import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = path => readFileSync(path, 'utf8')
const assetPath = asset => asset.replace(/^\.\//, '').split(/[?#]/, 1)[0]

// Inspect the actual generated bundle payload rather than infer executable
// contents from source script tags, which no longer exist on bundled pages.
function expandScript(siteRoot, asset) {
  const path = assetPath(asset)
  const source = read(resolve(siteRoot, path))
  if (!path.startsWith('bundles/')) return [{ asset: path, source }]
  const payload = source.match(/\}\)\((\[[\s\S]*\])\);\s*$/)
  if (!payload) throw new Error(`Unrecognized generated classic bundle: ${path}`)
  const entries = JSON.parse(payload[1])
  if (!entries.every(entry => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string')) {
    throw new Error(`Invalid generated classic bundle entries: ${path}`)
  }
  return entries.map(([asset, source]) => ({ asset, source }))
}

export function readGeneratedPage(siteRoot, page, { features = [] } = {}) {
  const html = read(resolve(siteRoot, page))
  const manifestTag = html.match(/<script\b(?=[^>]*\bid=["']kg-page-features["'])[^>]*>([\s\S]*?)<\/script>/)
  const manifest = manifestTag ? JSON.parse(manifestTag[1]) : {}
  const initial = Array.from(html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/g))
    .filter(match => !/\btype=["']application\/x-kg-feature["']/.test(match[0]))
    .flatMap(match => expandScript(siteRoot, match[1]))
  const entries = [...initial]
  const loaded = new Set()
  const loading = new Set()
  function includeFeature(name) {
    if (loaded.has(name)) return
    if (loading.has(name)) throw new Error(`Cyclic feature dependency: ${name}`)
    const feature = manifest[name]
    if (!feature) throw new Error(`Missing generated feature: ${name}`)
    loading.add(name)
    for (const dependency of feature.depends || []) includeFeature(dependency)
    for (const asset of feature.scripts || []) entries.push(...expandScript(siteRoot, asset))
    loading.delete(name)
    loaded.add(name)
  }
  for (const feature of features === 'all' ? Object.keys(manifest) : features) includeFeature(feature)
  return { html, manifest, initial, entries }
}
