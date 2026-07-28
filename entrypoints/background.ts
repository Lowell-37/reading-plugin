export default defineBackground(() => {
  browser.action.onClicked.addListener(async () => {
    const url = browser.runtime.getURL('/reader.html')
    const tabs = await browser.tabs.query({ url })
    if (tabs[0]?.id) {
      await browser.tabs.update(tabs[0].id, { active: true })
      if (tabs[0].windowId) await browser.windows.update(tabs[0].windowId, { focused: true })
      return
    }
    await browser.tabs.create({ url })
  })
})
