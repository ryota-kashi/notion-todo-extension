// バックグラウンドサービスワーカー

// 拡張機能アイコンクリック時にサイドパネルを開く
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});
