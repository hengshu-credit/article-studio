// Popup script for COSE extension
document.getElementById('openOfficial').addEventListener('click', e => {
  e.preventDefault()
  chrome.tabs.create({ url: 'https://article.hengshucredit.com' })
  window.close()
})
