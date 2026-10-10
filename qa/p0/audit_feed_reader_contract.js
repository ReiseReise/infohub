async (page) => {
  const token = await page.evaluate(() => localStorage.getItem('infohub_v3_access_token'));
  if (!token) throw new Error('当前浏览器尚未登录信息中枢');

  const listPayload = await page.evaluate(async (accessToken) => {
    const response = await fetch('/api/items?limit=80&sortBy=publishedAt', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`读取文章失败：HTTP ${response.status}`);
    return response.json();
  }, token);

  const candidates = (listPayload.data || []).filter((item) => item?.id && item?.sourceId);
  if (!candidates.length) throw new Error('当前没有可用的 Feed 文章');

  const featureSamples = {};
  for (const candidate of candidates.slice(0, 40)) {
    if (featureSamples.image && featureSamples.code && featureSamples.list && featureSamples.table) break;
    const detailPayload = await page.evaluate(async ({ accessToken, itemId }) => {
      const response = await fetch(`/api/items/${itemId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return null;
      return response.json();
    }, { accessToken: token, itemId: candidate.id });
    const item = detailPayload?.data || detailPayload?.item || detailPayload;
    if (!item) continue;
    const content = [item.readabilityContent, item.content, item.aiTranslation]
      .filter(Boolean)
      .join('\n');
    const sample = {
      id: candidate.id,
      sourceId: candidate.sourceId,
      title: candidate.title || 'Untitled',
    };
    if (!featureSamples.image && (/<img\b/i.test(content) || /!\[[^\]]*\]\s*\(/.test(content) || candidate.mediaUrl)) {
      featureSamples.image = sample;
    }
    if (!featureSamples.code && (/<pre\b/i.test(content) || /```[\s\S]*?```/.test(content))) {
      featureSamples.code = sample;
    }
    if (!featureSamples.list && (/<(?:ul|ol)\b/i.test(content) || /(?:^|\n)\s*(?:[-*+]\s+|\d+\.\s+)/.test(content))) {
      featureSamples.list = sample;
    }
    if (!featureSamples.table && (/<table\b/i.test(content) || /\|[^\n]+\|\s*\n\s*\|?\s*[:|-]+\|/.test(content))) {
      featureSamples.table = sample;
    }
  }

  const knownListPayload = await page.evaluate(async ({ accessToken, itemId }) => {
    const response = await fetch(`/api/items/${itemId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return response.json();
  }, { accessToken: token, itemId: 'a4a20db4-0bc6-4ec9-9f08-b953792476a7' });
  const knownListItem = knownListPayload?.data || knownListPayload?.item || knownListPayload;
  if (knownListItem?.id && knownListItem?.sourceId) {
    featureSamples.list = {
      id: knownListItem.id,
      sourceId: knownListItem.sourceId,
      title: knownListItem.title || 'List-rich article',
    };
  }

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const primary = featureSamples.code || featureSamples.image || featureSamples.list || candidates[0];
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`http://localhost/feed/${primary.id}?sourceId=${primary.sourceId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-feed-detail-header]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(400);

  const originalTab = page.getByRole('button', { name: /^\u539f\u6587(?: \u00b7 \u5f85\u8865\u5168)?$/ });
  if (await originalTab.count()) {
    await originalTab.first().click();
    await page.waitForTimeout(250);
  }

  const layout = await page.evaluate(() => {
    const workbench = document.querySelector('[data-feed-workbench]');
    const source = document.querySelector('[data-feed-source-pane]');
    const list = document.querySelector('[data-feed-list-pane]');
    const listScroll = document.querySelector('[data-feed-list-scroll]');
    const detail = document.querySelector('[data-feed-detail-pane]');
    const reader = document.querySelector('[data-feed-detail-reader]');
    const content = document.querySelector('[data-feed-detail-content-card]');
    const tabs = document.querySelector('[data-feed-detail-tabs]');
    const diagnostics = document.querySelector('[data-feed-diagnostics]');
    const firstCardTitle = document.querySelector('[data-feed-list-card-title]');
    const firstCardSummary = firstCardTitle?.parentElement?.querySelector('p');
    const rect = (node) => node ? {
      width: Math.round(node.getBoundingClientRect().width),
      height: Math.round(node.getBoundingClientRect().height),
    } : null;
    const canScroll = (node) => Boolean(node && node.scrollHeight > node.clientHeight + 1);

    if (source) source.scrollTop = Math.min(180, source.scrollHeight - source.clientHeight);
    if (listScroll) listScroll.scrollTop = Math.min(320, listScroll.scrollHeight - listScroll.clientHeight);
    if (reader) reader.scrollTop = Math.min(420, reader.scrollHeight - reader.clientHeight);

    return {
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      workbench: rect(workbench),
      source: rect(source),
      list: rect(list),
      detail: rect(detail),
      content: rect(content),
      panesVisible: [source, list, detail].every((node) => Boolean(node && node.getBoundingClientRect().width > 0)),
      independentScroll: {
        source: canScroll(source),
        list: canScroll(listScroll),
        detail: canScroll(reader),
        sourceTop: source?.scrollTop || 0,
        listTop: listScroll?.scrollTop || 0,
        detailTop: reader?.scrollTop || 0,
      },
      primaryTabs: tabs
        ? Array.from(tabs.querySelectorAll('button')).map((node) => (node.textContent || '').trim().replace(/ \u00b7 \u5f85\u8865\u5168$/, ''))
        : [],
      diagnosticsOpen: diagnostics instanceof HTMLDetailsElement ? diagnostics.open : null,
      allLowFrequencyClosed: Array.from(document.querySelectorAll('details[data-feed-diagnostics], [data-feed-detail-reader] details'))
        .every((node) => !(node instanceof HTMLDetailsElement) || !node.open),
      cardTitleClamped: Boolean(firstCardTitle?.className.includes('line-clamp-2')),
      cardSummaryClamped: Boolean(firstCardSummary?.className.includes('line-clamp-2')),
      readerOverflow: reader ? reader.scrollWidth > reader.clientWidth + 1 : true,
      contentOverflow: content ? content.scrollWidth > content.clientWidth + 1 : true,
    };
  });

  await page.setViewportSize({ width: 2200, height: 1080 });
  await page.waitForTimeout(150);
  const ultraWide = await page.evaluate(() => {
    const body = document.querySelector('[data-feed-detail-content-card]');
    const rail = body?.parentElement?.querySelector('aside');
    return {
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      bodyWidth: body ? Math.round(body.getBoundingClientRect().width) : 0,
      railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
      railPosition: rail ? getComputedStyle(rail).position : null,
    };
  });

  const richResults = [];
  const uniqueSamples = Array.from(new Map(
    Object.entries(featureSamples).map(([feature, sample]) => [sample.id, { ...sample, features: [feature] }]),
  ).values());
  for (const [feature, sample] of Object.entries(featureSamples)) {
    const existing = uniqueSamples.find((entry) => entry.id === sample.id);
    if (existing && !existing.features.includes(feature)) existing.features.push(feature);
  }

  for (const viewport of [
    { key: 'desktop', width: 1280, height: 900 },
    { key: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const sample of uniqueSamples) {
      await page.goto(`http://localhost/feed/${sample.id}`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-feed-detail-header]').waitFor({ state: 'visible', timeout: 15_000 });
      const tab = page.getByRole('button', { name: /^\u539f\u6587(?: \u00b7 \u5f85\u8865\u5168)?$/ });
      if (await tab.count()) await tab.first().click();
      await page.waitForTimeout(500);
      const metrics = await page.evaluate(() => {
        const reader = document.querySelector('[data-feed-detail-reader]');
        const card = document.querySelector('[data-feed-detail-content-card]');
        const nodes = (selector) => Array.from(card?.querySelectorAll(selector) || []);
        const overflow = (node) => node.scrollWidth > node.clientWidth + 1;
        const images = nodes('img');
        return {
          documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          readerOverflow: reader ? overflow(reader) : true,
          cardOverflow: card ? overflow(card) : true,
          cardWidth: card ? Math.round(card.getBoundingClientRect().width) : 0,
          imageCount: images.length,
          brokenImages: images.filter((image) => image.complete && image.naturalWidth === 0).length,
          tableCount: nodes('table').length,
          tableOverflow: nodes('table').some(overflow),
          codeBlockCount: nodes('pre').length,
          codeBlockOverflow: nodes('pre').some(overflow),
          listCount: nodes('ul,ol').length,
        };
      });
      richResults.push({ viewport: viewport.key, ...sample, ...metrics });
    }
  }

  const problems = [];
  if (!layout.panesVisible) problems.push('three_panes_not_visible');
  if (!layout.independentScroll.list || !layout.independentScroll.detail) problems.push('independent_scroll_missing');
  if (layout.primaryTabs.slice(0, 3).join('|') !== '摘要|原文|翻译') problems.push('primary_tabs_wrong');
  if (!layout.allLowFrequencyClosed || layout.diagnosticsOpen) problems.push('low_frequency_tools_open');
  if (!layout.cardTitleClamped || !layout.cardSummaryClamped) problems.push('card_hierarchy_wrong');
  if (layout.documentOverflow || layout.readerOverflow || layout.contentOverflow) problems.push('desktop_overflow');
  if (layout.content?.width < 760 || layout.content?.width > 860) problems.push('reader_width_out_of_range');
  if (ultraWide.documentOverflow || ultraWide.bodyWidth < 760 || ultraWide.bodyWidth > 860) problems.push('ultrawide_reader_wrong');
  if (ultraWide.railWidth !== 280 || ultraWide.railPosition !== 'sticky') problems.push('ultrawide_tools_rail_wrong');
  for (const result of richResults) {
    if (result.documentOverflow || result.readerOverflow || result.cardOverflow) problems.push(`${result.viewport}_${result.id}_overflow`);
    if (result.brokenImages) problems.push(`${result.viewport}_${result.id}_broken_images`);
    if (result.codeBlockOverflow) problems.push(`${result.viewport}_${result.id}_code_overflow`);
    if (result.tableOverflow) problems.push(`${result.viewport}_${result.id}_table_overflow`);
  }
  if (!featureSamples.table) problems.push('no_live_table_sample');
  if (consoleErrors.length) problems.push('console_errors');
  if (pageErrors.length) problems.push('page_errors');

  return {
    generatedAt: new Date().toISOString(),
    passed: problems.filter((problem) => problem !== 'no_live_table_sample').length === 0,
    problems,
    featureSamples,
    layout,
    ultraWide,
    richResults,
    consoleErrors,
    pageErrors,
  };
}
