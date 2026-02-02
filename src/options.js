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

// Notionユーザー一覧を取得
async function fetchUsers() {
  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) return [];
  
  try {
    const response = await fetch('https://api.notion.com/v1/users', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28'
      }
    });
    
    if (!response.ok) {
      console.warn(`ユーザー取得失敗: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.results.map(u => ({ id: u.id, name: u.name || 'Unknown' }));
  } catch (error) {
    console.error('ユーザー取得エラー:', error);
    return [];
  }
}

// データベーススキーマを取得
async function fetchDatabaseSchema(databaseId) {
  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) {
    throw new Error('APIキーが設定されていません');
  }

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`スキーマ取得失敗: ${response.status}`);
    }

    const data = await response.json();
    const schema = {};
    
    // プロパティ情報を整形
    for (const [name, prop] of Object.entries(data.properties)) {
      schema[name] = {
        type: prop.type,
        id: prop.id,
        select: prop.select,
        multi_select: prop.multi_select,
        status: prop.status,
        people: true // 担当者フィルター用マーカー
      };
    }
    
    return schema;
  } catch (error) {
    console.error('スキーマ取得エラー:', error);
    throw error;
  }
}

// 新しいデータベースを追加
async function addDatabase() {
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

  // スキーマを取得
  showMessage('スキーマを取得中...', 'success');
  try {
    const schema = await fetchDatabaseSchema(cleanId);
    
    // すべてのプロパティをデフォルトで表示
    const visibleProperties = Object.keys(schema);
    
    databases.push({ 
      id: cleanId, 
      name: name,
      schema: schema,
      visibleProperties: visibleProperties
    });
    saveToStorage();
    
    elements.dbName.value = '';
    elements.databaseId.value = '';
    renderDbList();
    showMessage('✓ データベースを追加しました', 'success');
  } catch (error) {
    showMessage(`エラー: ${error.message}`, 'error');
  }
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
async function openEditDbModal(index) {
  editingDbIndex = index;
  const db = databases[index];
  
  document.getElementById('editDbName').value = db.name;
  document.getElementById('editDbId').value = db.id;
  
  // スキーマがない場合は取得
  if (!db.schema) {
    try {
      showMessage('スキーマを取得中...', 'success');
      db.schema = await fetchDatabaseSchema(db.id);
      db.visibleProperties = Object.keys(db.schema); // デフォルトで全表示
      saveToStorage();
    } catch (error) {
      showMessage(`エラー: ${error.message}`, 'error');
      return;
    }
  }
  
  renderPropertyCheckboxes(db);
  renderFilters(db);
  
  document.getElementById('editDbModal').style.display = 'flex';
  document.body.style.overflow = 'hidden'; // 背景スクロール禁止
}

// プロパティチェックボックスを描画
function renderPropertyCheckboxes(db) {
  const container = document.getElementById('propertyCheckboxes');
  container.innerHTML = '';
  
  const visibleProps = db.visibleProperties || Object.keys(db.schema);
  
  for (const [propName, propInfo] of Object.entries(db.schema)) {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = propName;
    checkbox.checked = visibleProps.includes(propName);
    
    const span = document.createElement('span');
    span.textContent = `${getPropertyIcon(propInfo.type)} ${propName}`;
    
    label.appendChild(checkbox);
    label.appendChild(span);
    label.appendChild(span);
    container.appendChild(label);
  }
}

// フィルター設定を描画
function renderFilters(db) {
  const container = document.getElementById('filterList');
  container.innerHTML = '';
  
  if (db.filters && Array.isArray(db.filters)) {
    db.filters.forEach(filter => {
      addFilterRow(db, filter);
    });
  }
}

// フィルター行を追加
function addFilterRow(db, filterData = null) {
  try {
    const container = document.getElementById('filterList');
    
    if (!db || !db.schema) {
      alert('⚠️ データベースのスキーマ情報が見つかりません。\n右上の「🔄 更新」ボタンを押してみてください。');
      return;
    }

    const row = document.createElement('div');
    row.className = 'filter-item';
  
  // フィルタリング可能なプロパティを抽出
  const filterableProps = Object.entries(db.schema).filter(([name, prop]) => {
    return ['select', 'multi_select', 'status', 'checkbox', 'people'].includes(prop.type);
  });
  
  if (filterableProps.length === 0) {
    row.textContent = 'フィルタリング可能なプロパティがありません';
    container.appendChild(row);
    return;
  }
  
  // プロパティ選択
  const propSelect = document.createElement('select');
  propSelect.className = 'filter-prop-select';
  
  filterableProps.forEach(([name, prop]) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    option.dataset.type = prop.type;
    if (filterData && filterData.property === name) {
      option.selected = true;
    }
    propSelect.appendChild(option);
  });
  
  // 値入力エリア（動的に切り替え）
  const valueContainer = document.createElement('div');
  valueContainer.style.flex = '2';
  
  const updateValueInput = () => {
    valueContainer.innerHTML = '';
    const propName = propSelect.value;
    const prop = db.schema[propName];
    let input;

    if (prop.type === 'checkbox') {
      input = document.createElement('select');
      input.className = 'filter-value-input';
      const op1 = document.createElement('option'); op1.value = 'true'; op1.textContent = 'Checked (✅)';
      const op2 = document.createElement('option'); op2.value = 'false'; op2.textContent = 'Unchecked (⬜)';
      input.appendChild(op1);
      input.appendChild(op2);
      if (filterData && filterData.property === propName) input.value = filterData.value;
      
    } else if ((prop.type === 'select' || prop.type === 'multi_select') && prop[prop.type] && prop[prop.type].options) {
      input = document.createElement('select');
      input.className = 'filter-value-input';
      // 空の選択肢
      const emptyOp = document.createElement('option'); emptyOp.value = ''; emptyOp.textContent = '(選択してください)';
      input.appendChild(emptyOp);
      
      prop[prop.type].options.forEach(opt => {
        const op = document.createElement('option');
        op.value = opt.name;
        op.textContent = opt.name;
        input.appendChild(op);
      });
      if (filterData && filterData.property === propName) input.value = filterData.value;
      
    } else if (prop.type === 'status' && prop.status) {
      input = document.createElement('select');
      input.className = 'filter-value-input';
      const emptyOp = document.createElement('option'); emptyOp.value = ''; emptyOp.textContent = '(選択してください)';
      input.appendChild(emptyOp);
      
      // Statusは options または groups.options にある
      // Statusの選択肢を取得
      const options = [];
      if (prop.status.options) options.push(...prop.status.options);
      
      // groupsの処理は不要（optionsに全て含まれているため）およびエラー回避のため削除
      
      // 重複排除しつつ追加
      const seen = new Set();
      options.forEach(opt => {
        if (!seen.has(opt.name)) {
          seen.add(opt.name);
          const op = document.createElement('option');
          op.value = opt.name;
          op.textContent = opt.name;
          input.appendChild(op);
        }
      });
      if (filterData && filterData.property === propName) input.value = filterData.value;

    } else if (prop.type === 'people') {
      input = document.createElement('select');
      input.className = 'filter-value-input';
      const emptyOp = document.createElement('option'); emptyOp.value = ''; emptyOp.textContent = '(選択してください)';
      input.appendChild(emptyOp);
      
      if (db.users && db.users.length > 0) {
        db.users.forEach(u => {
          const op = document.createElement('option');
          op.value = u.id; // 値はUUID
          op.textContent = u.name;
          input.appendChild(op);
        });
      } else {
        // ユーザー情報がない場合
        const op = document.createElement('option');
        op.textContent = '⚠️ (更新ボタンを押してください)';
        input.appendChild(op);
        input.style.backgroundColor = '#fef2f2';
      }
      
      if (filterData && filterData.property === propName) input.value = filterData.value;
      
    } else {
      // Fallback: Text Input
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'filter-value-input';
      
      // スキーマ情報不足の場合（Select/Statusなのに選択肢がない）
      if (['select', 'multi_select', 'status'].includes(prop.type)) {
        input.placeholder = '⚠️ 最新の選択肢を取得するには「🔄 更新」ボタンを押してください';
        input.style.borderColor = '#fca5a5';
        input.style.backgroundColor = '#fef2f2';
        input.title = '選択肢情報がありません。右上の「更新」ボタンを押してデータベース情報を更新してください。';
      } else {
        input.placeholder = '値を入力';
      }
      
      if (filterData && filterData.property === propName) input.value = filterData.value;
    }
    
    valueContainer.appendChild(input);
  };

  propSelect.addEventListener('change', updateValueInput);
  updateValueInput(); // 初期実行
  
  // 削除ボタン
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-filter-btn';
  deleteBtn.innerHTML = '🗑️';
  deleteBtn.addEventListener('click', () => row.remove());
  
  row.appendChild(propSelect);
  row.appendChild(valueContainer);
  row.appendChild(deleteBtn);
  container.appendChild(row);
  } catch (e) {
    console.error('Filter Error:', e);
    alert('フィルター追加中にエラーが発生しました:\n' + e.message);
  }
}

// スキーマを強制更新
async function refreshSchema() {
  if (editingDbIndex === null) return;
  const db = databases[editingDbIndex];
  
  const btn = document.getElementById('refreshSchemaBtn');
  const originalText = btn.textContent;
  btn.textContent = '取得中...';
  btn.disabled = true;
  
  try {
    const newSchema = await fetchDatabaseSchema(db.id);
    db.schema = newSchema;
    
    // ユーザー一覧も更新して保存
    const users = await fetchUsers();
    db.users = users;
    
    // 新しいプロパティがある場合、デフォルトでは非表示にする（既存の設定を壊さないため）
    // あるいは全表示にする？ -> 既存の設定(visibleProperties)を維持する方針で。
    // 新しいプロパティは visibleProperties に含まれないので、自動的に非表示になる。
    // チェックボックスを描画し直す
    renderPropertyCheckboxes(db);
    // フィルターUIも再描画（プルダウン化を反映）
    renderFilters(db);
    
    saveToStorage();
    showMessage('✓ プロパティ情報を更新しました', 'success');
  } catch (error) {
    showMessage(`更新エラー: ${error.message}`, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
  
  document.getElementById('editDbModal').style.display = 'flex';
  document.body.style.overflow = 'hidden'; // 背景スクロール禁止
}

// プロパティタイプに応じたアイコンを取得
function getPropertyIcon(type) {
  const icons = {
    'title': '📌',
    'rich_text': '📝',
    'number': '🔢',
    'select': '🏷️',
    'multi_select': '🏷️',
    'date': '📅',
    'people': '👤',
    'files': '📎',
    'checkbox': '✅',
    'url': '🔗',
    'email': '📧',
    'phone_number': '📞',
    'formula': '🧮',
    'relation': '🔗',
    'rollup': '📊',
    'created_time': '🕐',
    'created_by': '👤',
    'last_edited_time': '🕐',
    'last_edited_by': '👤',
    'status': '📊'
  };
  return icons[type] || '📄';
}

// フィルター設定をUIから取得
function getFiltersFromUI() {
  const filters = [];
  const container = document.getElementById('filterList');
  if (!container) return filters;
  
  const filterRows = container.querySelectorAll('.filter-item');
  filterRows.forEach(row => {
    const propSelect = row.querySelector('.filter-prop-select');
    const valueInput = row.querySelector('.filter-value-input');
    
    if (propSelect && valueInput && valueInput.value.trim() !== "") {
      const option = propSelect.options[propSelect.selectedIndex];
      filters.push({
        property: propSelect.value,
        type: option.dataset.type,
        value: valueInput.value.trim()
      });
    }
  });
  return filters;
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
  
  // チェックされたプロパティを取得
  const container = document.getElementById('propertyCheckboxes');
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  const visibleProperties = [];
  
  checkboxes.forEach(checkbox => {
    if (checkbox.checked) {
      visibleProperties.push(checkbox.value);
    }
  });
  
  const db = databases[editingDbIndex];
  databases[editingDbIndex] = { 
    id: cleanId, 
    name: newName,
    schema: db.schema,
    visibleProperties: visibleProperties,
    filters: getFiltersFromUI()
  };
  saveToStorage();
  
  closeEditDbModal();
  renderDbList();
  showMessage('✓ データベースを更新しました', 'success');
}

function closeEditDbModal() {
  document.getElementById('editDbModal').style.display = 'none';
  editingDbIndex = null;
  document.body.style.overflow = ''; // 背景スクロール解除
}

  // イベントリスナー
elements.saveApiKeyBtn.addEventListener('click', saveApiKey);
elements.addDbBtn.addEventListener('click', addDatabase);
document.getElementById('refreshSchemaBtn').addEventListener('click', refreshSchema);
document.getElementById('addFilterBtn').addEventListener('click', () => {
  if (editingDbIndex !== null) {
    addFilterRow(databases[editingDbIndex]);
  }
});


// DB編集モーダル
document.getElementById('saveEditDbBtn').addEventListener('click', saveEditDb);
document.getElementById('cancelEditDbBtn').addEventListener('click', closeEditDbModal);
document.getElementById('editDbModal').addEventListener('click', (e) => {
  if (e.target.id === 'editDbModal') closeEditDbModal();
});

// 初期化実行
init();
