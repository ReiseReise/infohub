async (page) => {
  const viewports = [
    { key: 'desktop', width: 1280, height: 900 },
    { key: 'mobile', width: 390, height: 844 },
  ];

  const token = await page.evaluate(() => localStorage.getItem('infohub_v3_access_token'));
  if (!token) throw new Error('当前浏览器尚未登录信息中枢');

  const response = await page.evaluate(async (accessToken) => {
    const result = await fetch('/api/items?limit=100&sortBy=publishedAt', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!result.ok) throw new Error(`读取文章失败：HTTP ${result.status}`);
    return result.json();
  }, token);

  const sourceSeen = new Set();
  const samples = [];
  const candidates = (response.data || []).filter((item) => item?.id && item?.sourceId);
  const appendSample = (item) => {
    samples.push({
      id: item.id,
      sourceId: item.sourceId,
      sourceName: item.sourceName || `source-${item.sourceId}`,
      title: item.title || 'Untitled',
      contentStatus: item.contentStatus || null,
      readabilityStatus: item.readabilityStatus || null,
      translationStatus: item.translationStatus || null,
    });
  };

  for (const item of candidates) {
    if (sourceSeen.has(item.sourceId)) continue;
    sourceSeen.add(item.sourceId);
    appendSample(item);
    if (samples.length >= 20) break;
  }

  const sampledIds = new Set(samples.map((sample) => sample.id));
  for (const item of candidates) {
    if (samples.length >= 20) break;
    if (sampledIds.has(item.id)) continue;
    sampledIds.add(item.id);
    appendSample(item);
  }

  if (samples.length < 20) {
    throw new Error(`当前活跃文章只有 ${samples.length} 条，无法完成 20 条抽测`);
  }

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const results = [];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const sample of samples) {
      const consoleStart = consoleErrors.length;
      const pageErrorStart = pageErrors.length;
      await page.goto(`http://localhost/feed/${sample.id}`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-feed-detail-header]').waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(250);

      const originalTab = page.getByRole('button', { name: /^原文(?: · 待补全)?$/ });
      if (await originalTab.count()) {
        await originalTab.first().click();
        await page.waitForTimeout(150);
      }

      const metrics = await page.evaluate(() => {
        const reader = document.querySelector('[data-feed-detail-reader]');
        const card = document.querySelector('[data-feed-detail-content-card]');
        const tabs = document.querySelector('[data-feed-detail-tabs]');
        const diagnostics = document.querySelector('[data-feed-diagnostics]');
        const title = document.querySelector('[data-feed-detail-header] h2');
        const tabLabels = tabs
          ? Array.from(tabs.querySelectorAll('button')).map((node) => (node.textContent || '').trim())
          : [];
        const images = card ? Array.from(card.querySelectorAll('img')) : [];
        const brokenImages = images.filter((image) => image.complete && image.naturalWidth === 0).length;
        const pendingImages = images.filter((image) => !image.complete).length;
        const contentText = (card?.textContent || '').replace(/\s+/g, ' ').trim();
        const fixedOverlaps = Array.from(document.querySelectorAll('body *')).filter((node) => {
          if (!(node instanceof HTMLElement) || !card) return false;
          const style = getComputedStyle(node);
          if (style.position !== 'fixed' || style.visibility === 'hidden' || style.display === 'none') return false;
          const rect = node.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          if (rect.width <= 1 || rect.height <= 1) return false;
          return rect.left < cardRect.right
            && rect.right > cardRect.left
            && rect.top < cardRect.bottom
            && rect.bottom > cardRect.top;
        }).map((node) => ({
          tag: node.tagName.toLowerCase(),
          label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 60),
        }));

        return {
          url: location.href,
          title: (title?.textContent || '').trim(),
          itemNotFound: document.body.textContent?.includes('Item not found') || false,
          documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          readerOverflow: reader ? reader.scrollWidth > reader.clientWidth + 1 : true,
          cardOverflow: card ? card.scrollWidth > card.clientWidth + 1 : true,
          cardWidth: card ? Math.round(card.getBoundingClientRect().width) : 0,
          contentLength: contentText.length,
          imageCount: images.length,
          brokenImages,
          pendingImages,
          diagnosticsOpen: diagnostics instanceof HTMLDetailsElement ? diagnostics.open : null,
          tabLabels,
          fixedOverlaps,
        };
      });

      const problems = [];
      if (metrics.itemNotFound) problems.push('item_not_found');
      if (!metrics.title) problems.push('missing_title');
      if (metrics.documentOverflow) problems.push('document_overflow');
      if (metrics.readerOverflow) problems.push('reader_overflow');
      if (metrics.cardOverflow) problems.push('card_overflow');
      if (metrics.contentLength < 80) problems.push('content_too_short');
      if (metrics.brokenImages > 0) problems.push('broken_images');
      if (metrics.diagnosticsOpen) problems.push('diagnostics_open_by_default');
      if (metrics.tabLabels.slice(0, 3).map((label) => label.replace(/ · 待补全$/, '')).join('|') !== '摘要|原文|翻译') {
        problems.push('primary_tabs_wrong');
      }
      if (metrics.fixedOverlaps.length > 0) problems.push('fixed_overlay_overlap');
      if (viewport.key === 'desktop' && metrics.cardWidth > 860) problems.push('reader_too_wide');

      results.push({
        viewport: viewport.key,
        ...sample,
        ...metrics,
        consoleErrors: consoleErrors.slice(consoleStart),
        pageErrors: pageErrors.slice(pageErrorStart),
        problems,
      });
    }
  }

  const failed = results.filter((result) => (
    result.problems.length > 0
    || result.consoleErrors.length > 0
    || result.pageErrors.length > 0
  ));

  return {
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    sourceCount: sourceSeen.size,
    checks: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    samples,
    failures: failed,
    results,
  };
}
