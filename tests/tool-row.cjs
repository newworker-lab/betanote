// A pane's tool row keeps the tools a narrow pane has no room for in the panel under its ⋮ (desktop/renderer.js
// toolRowLayout). A test that is about to use such a tool opens the panel first, as a person would:
//   await (await toolShown(p, '[data-action="gpt-retranslate"]')).click();
// What comes back acts like the locator, but each use of it first makes sure the tool can be seen: the app draws a
// tool row again when its tools change (a translation ending, a page turning), and a panel opened a moment ago is
// then closed again. A tool that is in the row, or is no tool of a row at all, is used as it is.
const ACTIONS = new Set(['click', 'dblclick', 'fill', 'selectOption', 'check', 'uncheck', 'press', 'focus', 'hover', 'waitFor']);
module.exports = async function toolShown(page, selector) {
  const tool = page.locator(selector);
  const reveal = async () => {
    await tool.first().waitFor({ state: 'attached' });
    for (let attempt = 0; attempt < 8; attempt++) {
      await tool.first().evaluate(node => { const panel = node.closest('.tool-overflow'); if (panel?.hidden) panel.parentElement.querySelector(':scope>.tool-more').click(); }).catch(() => {});
      // Seen, and still seen a moment later (the row is not being drawn again just now).
      const seen = await tool.first().isVisible().catch(() => false);
      await page.waitForTimeout(120);
      if (seen && await tool.first().isVisible().catch(() => false)) return;
    }
  };
  await reveal();
  return new Proxy(tool, { get(target, name) {
    const value = target[name];
    if (typeof value !== 'function') return value;
    if (!ACTIONS.has(name)) return value.bind(target);
    return async (...args) => {
      // waitFor for anything but "seen" (attached, hidden, detached) is the caller's own question.
      if (name === 'waitFor' && args[0]?.state && args[0].state !== 'visible') return target.waitFor(...args);
      await reveal();
      return target[name](...args);
    };
  } });
};
