import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

export async function loadModule(file, dependencies, exports) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '')
    .replace(/^export /gm, '');
  return runSource(`${source}\nreturn { ${exports.join(', ')} };`, dependencies);
}

async function runSource(source, host) {
  // Keep transient TypeScript outside the DevTools project watcher.
  const directory = mkdtempSync(fileURLToPath(new URL('../../../.mini-test-runtime-', import.meta.url)));
  try {
    const path = join(directory, 'module.mts');
    writeFileSync(path, `export default function(host: any) { const { ${Object.keys(host).join(', ')} } = host;\n${source}\n}`);
    return (await import(pathToFileURL(path).href)).default(host);
  } finally {
    rmSync(directory, { recursive: true });
  }
}

// Execute the real Page handlers with a minimal WeChat host and injectable API boundary.
export async function loadPage(name, dependencies = {}, wxOverrides = {}) {
  const source = readFileSync(new URL(`../../pages/${name}/index.ts`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '');
  let page;
  const navigation = [];
  const wx = {
    getWindowInfo: () => ({ statusBarHeight: 24 }),
    reLaunch: data => navigation.push(data),
    redirectTo: data => navigation.push(data),
    navigateTo: data => navigation.push(data),
    switchTab: data => navigation.push(data),
    navigateBack: data => navigation.push(data),
    pageScrollTo() {}, showToast() {}, stopPullDownRefresh() {},
    showModal: async () => ({ confirm: true }),
    ...wxOverrides,
  };
  const host = {
    Date, Promise, Set, Map, Object, String, Number, Error, JSON, Math,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1,
    wx, showDialog: options => wx.showModal(options), ...dependencies,
    Page(options) { page = options; page.setData = values => Object.assign(page.data, values); },
  };
  const appearance = await loadModule('domain/appearance.ts', { wx }, ['appearanceData', 'readAppearance', 'subscribeAppearance', 'updateAppearanceChrome']);
  const { withAppearance } = await loadModule('domain/appearance-page.ts', { ...appearance, ...dependencies }, ['withAppearance']);
  host.withAppearance = withAppearance;
  host.navigation = (await loadModule('domain/navigation.ts', { wx }, ['navigation'])).navigation;
  await runSource(source, host);
  return { page, navigation, wx };
}
