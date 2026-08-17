const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('1. Navigating to practice-mode.html...');
    await page.goto('http://127.0.0.1:8000/practice-mode.html');
    await page.waitForLoadState('networkidle');

    console.log('2. Logging in via fetch in browser context...');
    const loginResult = await page.evaluate(async () => {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'admin123',
          acceptedTermsVersion: '2026-08-13-v1'
        })
      });
      return {
        status: response.status,
        ok: response.ok,
        data: await response.json()
      };
    });
    console.log('Login result:', loginResult);

    console.log('3. Reloading page after login...');
    await page.reload();
    await page.waitForLoadState('networkidle');

    console.log('4. Waiting for bootstrap to complete...');
    await page.waitForTimeout(3000); // Wait 3 seconds for bootstrap

    console.log('5. Collecting diagnostic data...');
    const diagnosticData = await page.evaluate(() => {
      return {
        KGPracticeMode: !!window.KGPracticeMode,
        loadReleasesExists: typeof window.KGPracticeMode?.loadReleases === 'function',
        releases: window.KGPracticeMode?.loadReleases?.(),
        releasesLength: window.KGPracticeMode?.loadReleases?.()?.length,
        repoListResult: window.KGPublishedPaperRepository?.listCatalogEntries?.({mode:'practice_mode'}),
        firstPaper: window.KGPublishedPaperRepository?.listCatalogEntries?.({mode:'practice_mode'})?.[0],
        storageFirstChars: (localStorage.getItem('kg_exam_papers_published_v1') || '').substring(0, 100)
      };
    });

    console.log('\n=== DIAGNOSTIC DATA ===');
    console.log(JSON.stringify(diagnosticData, null, 2));
    console.log('======================\n');

    // Short wait then close
    await page.waitForTimeout(2000);

  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    await browser.close();
  }
})();
