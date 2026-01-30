// Notion TODO Manager - 設定ページロジック

const elements = {
  apiKey: document.getElementById('apiKey'),
  saveApiKeyBtn: document.getElementById('saveApiKeyBtn'),

  dbName: document.getElementById('dbName'),
  databaseId: document.getElementById('databaseId'),
  addDbBtn: document.getElementById('addDbBtn'),
  dbList: document.getElementById('dbList'),
  saveMessage: document.getElementById('saveMessage'),
};

let databases = [];
let editingDbIndex = null;

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
        <strong class="db-name">${escapeHtml(db.name)}</strong>
        <span class="db-id">${db.id.slice(0, 8)}...</span>
      </div>
      <div class="db-actions">
        <button class="btn-edit" data-index="${index}">✏️ 編集</button>
        <button class="btn-delete" data-index="${index}">🗑️ 削除</button>
      </div>
    `;
    elements.dbList.appendChild(item);
  });

  // 編集・削除イベントの紐付け
  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.currentTarget.dataset.index);
      openEditDbModal(index);
    });
  });
  
  document.querySelectorAll('.btn-delete').forEach(btn => {
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


// ========== DB編集機能 ==========

// DB編集モーダルを開く
function openEditDbModal(index) {
  editingDbIndex = index;
  const db = databases[index];
  
  document.getElementById('editDbName').value = db.name;
  document.getElementById('editDbId').value = db.id;
  document.getElementById('editDbModal').style.display = 'flex';
}

// DB編集を保存
async function saveEditDb() {
  const newName = document.getElementById('editDbName').value.trim();
  let newId = document.getElementById('editDbId').value.trim();
  
  if (!newName || !newId) {
    showMessage('名前とIDを入力してください', 'error');
    return;
  }
  
  // IDのクレンジング
  const cleanId = newId.replace(/[-\s]/g, '');
  if (!/^[a-f0-9]{32}$/i.test(cleanId)) {
    showMessage('データベースIDの形式が正しくありません', 'error');
    return;
  }
  
  databases[editingDbIndex] = { id: cleanId, name: newName };
  saveToStorage();
  
  closeEditDbModal();
  renderDbList();
  showMessage('✓ データベースを更新しました', 'success');
}

function closeEditDbModal() {
  document.getElementById('editDbModal').style.display = 'none';
  editingDbIndex = null;
}

// イベントリスナー
elements.saveApiKeyBtn.addEventListener('click', saveApiKey);

elements.addDbBtn.addEventListener('click', addDatabase);


// DB編集モーダル
document.getElementById('saveEditDbBtn').addEventListener('click', saveEditDb);
document.getElementById('cancelEditDbBtn').addEventListener('click', closeEditDbModal);
document.getElementById('editDbModal').addEventListener('click', (e) => {
  if (e.target.id === 'editDbModal') closeEditDbModal();
});

// 初期化実行
init();
