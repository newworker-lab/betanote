// A pane's tool row keeps the tools a narrow pane has no room for in the panel under its ⋯ (desktop/renderer.js
// toolRowLayout). A test that is about to use such a tool opens the panel first, as a person would:
//   await (await toolShown(p, '[data-action="gpt-retranslate"]')).click();
// The locator comes back as it is when the tool is in the row, or is not a tool of a row at all.
module.exports = async function toolShown(page, selector) {
  const tool = page.locator(selector);
  await tool.first().waitFor({ state: 'attached' });
  await tool.first().evaluate(node => { const panel = node.closest('.tool-overflow'); if (panel?.hidden) panel.parentElement.querySelector(':scope>.tool-more').click(); });
  return tool;
};
