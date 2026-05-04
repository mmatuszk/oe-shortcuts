document.getElementById("openOptionsButton").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
