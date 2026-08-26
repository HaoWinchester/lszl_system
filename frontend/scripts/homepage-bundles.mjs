import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function normalizeAsset(value) {
  return value
    .trim()
    .replace(/^\.\//, '')
    .split(/[?#]/, 1)[0]
}

function assetMatches(html, kind) {
  const pattern = kind === 'script'
    ? /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi
    : /<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/gi
  return Array.from(html.matchAll(pattern), (match) => ({
    tag: match[0],
    asset: normalizeAsset(match[1]),
    index: match.index,
  }))
}

function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.groups) || plan.groups.length === 0) {
    throw new Error('homepage bundle plan must declare at least one group')
  }
  const names = new Set()
  const scripts = new Set()
  const styles = new Set()
  for (const group of plan.groups) {
    if (!group?.name || names.has(group.name)) throw new Error(`duplicate homepage bundle group: ${group?.name || ''}`)
    names.add(group.name)
    for (const kind of ['scripts', 'styles']) {
      if (!Array.isArray(group[kind])) throw new Error(`${group.name}.${kind} must be an array`)
      const seen = kind === 'scripts' ? scripts : styles
      for (const rawAsset of group[kind]) {
        const asset = normalizeAsset(rawAsset)
        if (seen.has(asset)) throw new Error(`duplicate homepage ${kind.slice(0, -1)} asset: ${asset}`)
        seen.add(asset)
      }
    }
  }
}

function validateCoverage(outputRoot, matches, groups, kind) {
  const declared = groups.flatMap((group) => group[kind]).map(normalizeAsset)
  const pageAssets = matches
    .map((match) => match.asset)
    .filter((asset) => !asset.startsWith('bundles/'))
  const pageSet = new Set(pageAssets)
  for (const asset of declared) {
    if (!pageSet.has(asset)) throw new Error(`homepage ${kind.slice(0, -1)} missing from index.html: ${asset}`)
    if (!existsSync(resolve(outputRoot, asset))) throw new Error(`homepage ${kind.slice(0, -1)} file is missing: ${asset}`)
  }
  for (const asset of pageAssets) {
    if (!declared.includes(asset)) throw new Error(`ungrouped homepage ${kind.slice(0, -1)} asset: ${asset}`)
  }
}

function concatenate(outputRoot, assets, commentPrefix) {
  return assets
    .map(normalizeAsset)
    .map((asset) => `/* ${commentPrefix}: ${asset} */\n${readFileSync(resolve(outputRoot, asset), 'utf8').trimEnd()}\n;`)
    .join('\n') + '\n'
}

function replaceTags(html, matches, replacement) {
  if (!matches.length) return html
  const firstIndex = matches[0].index
  const remove = new Set(matches.map((match) => match.tag))
  let inserted = false
  return html.replace(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>|<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["'][^"']+["'])[^>]*>/gi, (tag, offset) => {
    if (!remove.has(tag)) return tag
    if (!inserted && offset === firstIndex) {
      inserted = true
      return replacement
    }
    return ''
  })
}

function alreadyBuilt(html, plan, outputRoot) {
  const outputs = plan.groups.flatMap((group) => [
    ...(group.scripts.length ? [`bundles/${group.name}.js`] : []),
    ...(group.styles.length ? [`bundles/${group.name}.css`] : []),
  ])
  return outputs.length > 0
    && outputs.every((asset) => html.includes(asset) && existsSync(resolve(outputRoot, asset)))
}

export function buildHomepageBundles({ outputRoot, version, plan }) {
  validatePlan(plan)
  const indexPath = resolve(outputRoot, 'index.html')
  let html = readFileSync(indexPath, 'utf8')
  if (alreadyBuilt(html, plan, outputRoot)) return { indexPath, groups: plan.groups.map((group) => group.name) }

  const scriptMatches = assetMatches(html, 'script')
  const styleMatches = assetMatches(html, 'style')
  validateCoverage(outputRoot, scriptMatches, plan.groups, 'scripts')
  validateCoverage(outputRoot, styleMatches, plan.groups, 'styles')

  const bundleDir = resolve(outputRoot, 'bundles')
  mkdirSync(bundleDir, { recursive: true })
  for (const group of plan.groups) {
    if (group.scripts.length) {
      writeFileSync(resolve(bundleDir, `${group.name}.js`), concatenate(outputRoot, group.scripts, 'source'))
    }
    if (group.styles.length) {
      writeFileSync(resolve(bundleDir, `${group.name}.css`), concatenate(outputRoot, group.styles, 'style'))
    }
  }

  const scriptTags = plan.groups
    .filter((group) => group.scripts.length)
    .map((group) => `<script${group.defer ? ' defer' : ''} src="bundles/${group.name}.js?v=${version}"></script>`)
    .join('\n')
  const styleTags = plan.groups
    .filter((group) => group.styles.length)
    .map((group) => `<link rel="stylesheet" href="bundles/${group.name}.css?v=${version}">`)
    .join('\n')

  html = replaceTags(html, scriptMatches, scriptTags)
  html = replaceTags(html, styleMatches, styleTags)
  writeFileSync(indexPath, html)
  return { indexPath, groups: plan.groups.map((group) => group.name) }
}
