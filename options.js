// Notion TODO Manager - 設定ページロジック

const elements = {
  apiKey: document.getElementById('apiKey'),
  saveApiKeyBtn: document.getElementById('saveApiKeyBtn'),
  dbName: document.getElementById('dbName'),
  databaseId: document.getElementById('databaseId'),
  addDbBtn: document.getElementById('addDbBtn'),
  dbList: document.getElementById('dbList'),
  saveMessage: document.getElementById('saveMessage')
};

let databases = [];

// 初期化: 保存済みの設定を読み込む
async function init() {
  chrome.storage.sync.get(['notionApiKey', 'notionDatabases', 'notionDatabaseId'], (result) => {
    // APIキーの読み込み
    if (result.notionApiKey) {
      elements.apiKey.value = result.notionApiKey;
    }

    // データベースリストの読み込み
    if (result.notionDatabases) {
      databases = result.notionDatabases;
    } else if (result.notionDatabaseId) {
      // 旧バージョンからの移行: 既存のIDがある場合は「デフォルト」として登録
      databases = [{
        id: result.notionDatabaseId,
        name: 'デフォルト'
      }];
      saveToStorage();
    }
    
    renderDbList();
  });
}

// APIキーのみ保存
function saveApiKey() {
  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) {
    showMessage('APIキーを入力してください', 'error');
    return;
  }
  if (!apiKey.startsWith('secret_') && !apiKey.startsWith('ntn_')) {
    showMessage('APIキーの形式が正しくありません', 'error');
    return;
  }

  chrome.storage.sync.set({ notionApiKey: apiKey }, () => {
    showMessage('✓ APIキーを保存しました', 'success');
  });
}

// 新しいデータベースを追加
function addDatabase() {
  const name = elements.dbName.value.trim();
  let id = elements.databaseId.value.trim();

  if (!name || !id) {
    showMessage('名前とIDの両方を入力してください', 'error');
    return;
  }

  // IDのクレンジング
  const cleanId = id.replace(/[-\s]/g, '');
  if (!/^[a-f0-9]{32}$/i.test(cleanId)) {
    showMessage('データベースIDの形式が正しくありません', 'error');
    return;
  }

  // 重複チェック
  if (databases.find(db => db.id === cleanId)) {
    showMessage('このデータベースは既に登録されています', 'error');
    return;
  }

  databases.push({ id: cleanId, name: name });
  saveToStorage();
  
  elements.dbName.value = '';
  elements.databaseId.value = '';
  renderDbList();
  showMessage('✓ データベースを追加しました', 'success');
}

// データベースを削除
function deleteDb(index) {
  databases.splice(index, 1);
  saveToStorage();
  renderDbList();
}

// ストレージに保存
function saveToStorage() {
  chrome.storage.sync.set({ notionDatabases: databases });
}

// データベースリストをUIに表示
function renderDbList() {
  elements.dbList.innerHTML = '';
  
  if (databases.length === 0) {
    elements.dbList.innerHTML = '<p class="empty-list-msg">データベースが登録されていません</p>';
    return;
  }

  databases.forEach((db, index) => {
    const item = document.createElement('div');
    item.className = 'db-item';
    item.innerHTML = `
      <div class="db-info">
        <span class="db-name">${escapeHtml(db.name)}</span>
        <span class="db-id">ID: ${db.id.slice(0, 8)}...</span>
      </div>
      <button class="delete-btn" data-index="${index}" title="削除">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
        </svg>
      </button>
    `;
    elements.dbList.appendChild(item);
  });

  // 削除イベントの紐付け
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.currentTarget.dataset.index);
      deleteDb(index);
    });
  });
}

// メッセージ表示
function showMessage(message, type) {
  elements.saveMessage.textContent = message;
  elements.saveMessage.className = `save-message ${type}`;
  elements.saveMessage.style.display = 'block';
  setTimeout(() => elements.saveMessage.style.display = 'none', 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// イベントリスナー
elements.saveApiKeyBtn.addEventListener('click', saveApiKey);
elements.addDbBtn.addEventListener('click', addDatabase);

// 初期化実行
init();
