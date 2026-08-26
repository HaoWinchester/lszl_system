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

function concatenateScripts(outputRoot, assets) {
  const sources = assets.map(normalizeAsset).map((asset) => [
    asset,
    `${readFileSync(resolve(outputRoot, asset), 'utf8').trimEnd()}\n//# sourceURL=${asset}`,
  ])
  return `'use strict';\n(function executeClassicHomepageBundle(sources){\n`
    + `  const host=document.head||document.documentElement;\n`
    + `  for(const [asset,source] of sources){\n`
    + `    const script=document.createElement('script');\n`
    + `    script.dataset.kgBundleSource=asset;\n`
    + `    script.textContent=source;\n`
    + `    host.appendChild(script);\n`
    + `    script.remove();\n`
    + `  }\n`
    + `})(${JSON.stringify(sources)});\n`
}

function concatenateStyles(outputRoot, assets) {
  return assets
    .map(normalizeAsset)
    .map((asset) => `/* style: ${asset} */\n${readFileSync(resolve(outputRoot, asset), 'utf8').trimEnd()}`)
    .join('\n') + '\n'
}

function replaceTags(html, matches, replacement) {
  if (!matches.length) return html
  const remove = new Set(matches.map((match) => match.tag))
  let inserted = false
  return html.replace(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>|<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["'][^"']+["'])[^>]*>/gi, (tag) => {
    if (!remove.has(tag)) return tag
    if (!inserted) {
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
  return html.includes('<meta name="kg-homepage-bundle-version"')
    && outputs.length > 0
    && outputs.every((asset) => existsSync(resolve(outputRoot, asset)))
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
      writeFileSync(resolve(bundleDir, `${group.name}.js`), concatenateScripts(outputRoot, group.scripts))
    }
    if (group.styles.length) {
      writeFileSync(resolve(bundleDir, `${group.name}.css`), concatenateStyles(outputRoot, group.styles))
    }
  }

  const safeVersion = String(version).replace(/[&"<>]/g, (character) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[character])
  const scriptTags = [
    `<meta name="kg-homepage-bundle-version" content="${safeVersion}">`,
    ...plan.groups
    .filter((group) => group.initial && group.scripts.length)
    .map((group) => `<script${group.defer ? ' defer' : ''} src="bundles/${group.name}.js?v=${version}"></script>`)
  ].join('\n')
  const styleTags = plan.groups
    .filter((group) => group.initial && group.styles.length)
    .map((group) => `<link rel="stylesheet" href="bundles/${group.name}.css?v=${version}">`)
    .join('\n')

  html = replaceTags(html, scriptMatches, scriptTags)
  html = replaceTags(html, styleMatches, styleTags)
  writeFileSync(indexPath, html)
  return { indexPath, groups: plan.groups.map((group) => group.name) }
}
