// Run this whole file as Code Mode JavaScript with the browser skill loaded.
// Requires the isolated /schedule page, signed in, narrow viewport, closed menu.
// Native browser.press drives keys; DOM focus only establishes boundary starts.
// Returns assertion results, including failures, and closes the menu in finally.
const tabs = await tools.browser.tabs.list();
const tab = tabs.tabs.find(t => t.url === 'http://127.0.0.1:3300/schedule');
if (!tab || tab.loading) throw new Error('Load the isolated /schedule page first.');
const tabID = tab.id;
const inspect = async () => (await tools.browser.evaluate({ tabID, script: `
  new Promise(resolve => requestAnimationFrame(() => {
    const sidebar = document.querySelector('aside.sidebar');
    const toggle = document.querySelector('.nav-toggle');
    const active = document.activeElement;
    const items = [...sidebar.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
    const rail = sidebar.querySelector('.rail-toggle');
    resolve({ width: innerWidth, height: innerHeight, lang: document.documentElement.lang,
      open: toggle.getAttribute('aria-expanded') === 'true', inert: sidebar.inert,
      active: { tag: active.tagName, id: active.id, class: active.className },
      inside: sidebar.contains(active), first: active === items[0],
      last: active === items.at(-1), toggle: active === toggle,
      hiddenRail: !!rail && getComputedStyle(rail).display === 'none' });
  }))` })).value;
const before = await inspect();
if (before.width > 880 || before.open || !before.inert) throw new Error('Expected a closed narrow-screen menu.');
const observations = { before };
try {
  await tools.browser.evaluate({ tabID, script: 'document.querySelector(".nav-toggle").focus()' });
  await tools.browser.press({ tabID, key: 'Enter' });
  observations.open = await inspect();
  if (!observations.open.open) throw new Error('Native Enter did not open the menu.');
  await tools.browser.press({ tabID, key: 'Tab' });
  observations.forward = await inspect();
  await tools.browser.evaluate({ tabID, script: 'document.querySelector("aside .panel-back").focus()' });
  await tools.browser.press({ tabID, key: 'Shift+Tab' });
  observations.reverse = await inspect();
  await tools.browser.evaluate({ tabID, script: 'document.querySelector("aside .account-signout").focus()' });
  await tools.browser.press({ tabID, key: 'Tab' });
  observations.wrap = await inspect();
} finally {
  await tools.browser.press({ tabID, key: 'Escape' });
  observations.escape = await inspect();
}
const checks = [
  { name: 'opening focuses first visible menu control', pass: observations.open.first },
  { name: 'forward Tab stays inside open menu', pass: observations.forward.inside },
  { name: 'reverse Tab from first wraps to last', pass: observations.reverse.last },
  { name: 'forward Tab from last wraps to first', pass: observations.wrap.first },
  { name: 'Escape closes and restores toggle focus', pass: !observations.escape.open && observations.escape.toggle },
  { name: 'closed sidebar becomes inert', pass: observations.escape.inert },
];
return { tabID, generation: tab.generation, observations, checks,
  passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length };
