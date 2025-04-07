document.addEventListener('DOMContentLoaded', function () {
  let currentTabId;

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    currentTabId = tabs[0].id;
  });

  document.getElementById('start').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: "start", tabId: currentTabId });
    window.close()
  });

  document.getElementById('stop').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: "stop", tabId: currentTabId });
    window.close()
  });

  // 更新录制状态
  chrome.runtime.onMessage.addListener(function (message) {
    if (message.type === "status") {
      const statusDiv = document.getElementById('status');
      statusDiv.textContent = message.text;
      statusDiv.style.color = message.color || "black";
    }
  });
});

