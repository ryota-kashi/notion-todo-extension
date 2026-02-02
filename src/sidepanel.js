// Notion TODO Manager - サイドパネルロジック

let config = {
  apiKey: "",
  databases: [],
  activeDatabaseId: "",
};
let todos = [];
let showAllDatabases = false;
const databaseSchemas = {};
let titlePropertyName = ""; // 後方互換性のため維持(後で削除or更新)

// DOM要素
const elements = {
  setupMessage: document.getElementById("setupMessage"),
  loading: document.getElementById("loading"),
  errorMessage: document.getElementById("errorMessage"),
  addTaskForm: document.getElementById("addTaskForm"),
  todoList: document.getElementById("todoList"),
  refreshBtn: document.getElementById("refreshBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  openOptionsBtn: document.getElementById("openOptionsBtn"),
  newTaskInput: document.getElementById("newTaskInput"),
  addTaskBtn: document.getElementById("addTaskBtn"),
  dbSelector: document.getElementById("dbSelector"),
  showAllDbToggle: document.getElementById("showAllDbToggle"),
};

// 初期化
async function init() {
  const result = await loadConfig();
  config.apiKey = result.apiKey;
  config.databases = result.databases;

  if (!config.apiKey || config.databases.length === 0) {
    showSetupMessage();
    return;
  }

  // セレクターを構築
  renderDbSelector();

  // 前回の選択を復元
  chrome.storage.sync.get(["activeDatabaseId"], async (save) => {
    const savedId = save.activeDatabaseId;
    if (savedId && config.databases.find((db) => db.id === savedId)) {
      config.activeDatabaseId = savedId;
      elements.dbSelector.value = savedId;
    } else {
      config.activeDatabaseId = config.databases[0].id;
      elements.dbSelector.value = config.databases[0].id;
    }

    hideSetupMessage();
    await loadTodos();
  });
}

// セレクターUIの描画
function renderDbSelector() {
  elements.dbSelector.innerHTML = "";
  config.databases.forEach((db) => {
    const option = document.createElement("option");
    option.value = db.id;
    option.textContent = db.name;
    elements.dbSelector.appendChild(option);
  });
}

// DB切り替えイベント
elements.dbSelector.addEventListener("change", async (e) => {
  const newId = e.target.value;
  config.activeDatabaseId = newId;
  titlePropertyName = ""; // キャッシュをクリア
  // databaseSchema = null; // 廃止
  chrome.storage.sync.set({ activeDatabaseId: newId });
  if (!showAllDatabases) {
    await loadTodos();
  }
});

// 全DB表示トグルイベント
elements.showAllDbToggle.addEventListener("change", async (e) => {
  showAllDatabases = e.target.checked;
  // トグル変更時はactiveDatabaseIdは変更しないが、表示モードが変わる
  elements.dbSelector.disabled = showAllDatabases;
  await loadTodos();
});

// 設定を読み込む
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ["notionApiKey", "notionDatabases", "notionDatabaseId"],
      (result) => {
        let databases = result.notionDatabases || [];

        // 旧バージョンからの移行
        if (databases.length === 0 && result.notionDatabaseId) {
          databases = [{ id: result.notionDatabaseId, name: "デフォルト" }];
        }

        resolve({
          apiKey: (result.notionApiKey || "").trim(),
          databases: databases,

        });
      },
    );
  });
}

// ヘルパー: 現在のDB IDを取得
function getActiveDatabaseId() {
  return config.activeDatabaseId;
}

// グローバルキャッシュ
// let titlePropertyName = ""; // Removed
// let databaseSchema = null; // 廃止: databaseSchemas[dbId] を使用
let editingTodoId = null; // 現在編集中のTODO ID
const pageTitleCache = {}; // リレーションタイトルのキャッシュ
const pendingRequests = {}; // リクエストの重複排除用

// データベーススキーマを取得(プロパティ名とオプションを取得)
async function getDatabaseSchema(dbId) {
  if (!dbId) dbId = getActiveDatabaseId();
  if (!dbId) return null;

  if (databaseSchemas[dbId]) return databaseSchemas[dbId];

  const response = await fetch(
    `https://api.notion.com/v1/databases/${dbId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Notion-Version": "2022-06-28",
      },
    },
  );

  if (!response.ok) {
      console.error(`Failed to fetch schema for ${dbId}`, response);
      return null;
      // throw new Error("スキーマ取得失敗"); // エラーを投げずにnullを返す方が安全かも
  }

  const data = await response.json();
  const schema = {
    properties: data.properties,
    titlePropertyName: null,
    datePropertyName: null,
    tagPropertyName: null,
    statusPropertyName: null,
    checkboxPropertyName: null,
    availableTags: [],
    completedStatusNames: [],
  };

  // プロパティを解析
  for (const [name, prop] of Object.entries(data.properties)) {
    // タイトル
    if (prop.type === "title") {
      schema.titlePropertyName = name;
    }
    // 日付
    else if (prop.type === "date" && !schema.datePropertyName) {
      schema.datePropertyName = name;
    }
    // タグ (Multi-select)
    else if (prop.type === "multi_select" && !schema.tagPropertyName) {
      schema.tagPropertyName = name;
      schema.availableTags = prop.multi_select.options.map(
        (opt) => opt.name,
      );
    }
    // ステータス
    else if (prop.type === "status" && !schema.statusPropertyName) {
      schema.statusPropertyName = name;
      
      // "Complete" または "完了" グループに属するオプション名を抽出
      if (prop.status && prop.status.groups) {
        const completeGroups = prop.status.groups.filter(g => 
          g.name === "Complete" || g.name === "Completed" || g.name === "完了"
        );
        const completeGroupIds = completeGroups.map(g => g.id);
        
        if (prop.status.options) {
            prop.status.options.forEach(opt => {
                if (completeGroupIds.includes(opt.group_id) || completeGroups.some(g => g.name === opt.name)) {
                    schema.completedStatusNames.push(opt.name);
                }
            });
        }
      }
      // デフォルト: "Done", "Complete", "完了" は常に完了扱いにする
      ["Done", "Complete", "Completed", "完了"].forEach(st => {
          if (!schema.completedStatusNames.includes(st)) {
              schema.completedStatusNames.push(st);
          }
      });
    }
    // チェックボックス
    else if (prop.type === "checkbox" && !schema.checkboxPropertyName) {
        schema.checkboxPropertyName = name;
    }
  }

  // キャッシュに保存
  databaseSchemas[dbId] = schema;

  // 後方互換性変数（アクティブなDBの場合のみ更新）
  if (dbId === getActiveDatabaseId()) {
      titlePropertyName = schema.titlePropertyName;
  }

  return schema;
}

// TODOを読み込む
// TODOを読み込む
async function loadTodos() {
  showLoading();
  hideError();

  try {
    let allTodos = [];

    // 取得対象のDBリストを作成
    const targetDbs = showAllDatabases
      ? config.databases
      : config.databases.filter((db) => db.id === getActiveDatabaseId());

    if (targetDbs.length === 0) {
      if (!showAllDatabases && !getActiveDatabaseId()) {
         console.warn("Database ID is missing.");
         return;
      }
    }

    // 並列で取得
    const promises = targetDbs.map((db) => fetchTodosFromDb(db.id));
    const results = await Promise.all(promises);

    // 結果を結合
    allTodos = results.flat();

    // 4. ソート
    todos = allTodos.sort((a, b) => {
      const aDone = getTodoStatus(a);
      const bDone = getTodoStatus(b);
      if (aDone === bDone) {
          // 作成日時でソート (新しい順)
          return new Date(b.created_time) - new Date(a.created_time);
      }
      return aDone ? 1 : -1;
    });

    hideLoading();
    renderTodos();
  } catch (error) {
    hideLoading();
    console.error("Load Error:", error);
    showError(`Error: ${error.message}`);
  }
}

// 単一DBからTODOを取得
async function fetchTodosFromDb(dbId) {
  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${dbId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sorts: [
            {
              timestamp: "created_time",
              direction: "descending",
            },
          ],
        }),
      },
    );

    if (!response.ok) {
        console.warn(`Failed to fetch from DB ${dbId}: ${response.status}`);
        return [];
    }
    
    const data = await response.json();

    // スキーマ確保
    const schema = await getDatabaseSchema(dbId);
    if (!schema) return [];

    const activeTitleKey = schema.titlePropertyName || "Name";

    // フィルタリング
    return data.results.filter((page) => {
      // アーカイブ済みは除外
      if (page.archived) return false;

      // タイトルが空のページは除外
      const titleProp = page.properties[activeTitleKey];
      const hasTitle =
        titleProp &&
        titleProp.title &&
        titleProp.title.length > 0 &&
        titleProp.title[0].plain_text.trim() !== "";
      if (!hasTitle) return false;

      // 完了済みタスクは除外
      return !getTodoStatus(page); // getTodoStatus now supports mixed DBs
    });

  } catch (e) {
      console.error(`Error fetching DB ${dbId}`, e);
      return [];
  }
}

// TODOを表示
function renderTodos() {
  elements.todoList.innerHTML = "";

  if (todos.length === 0) {
    elements.todoList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 11l3 3L22 4"></path>
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"></path>
        </svg>
        <p>タスクがありません</p>
      </div>
    `;
    return;
  }

  todos.forEach((todo) => {
    const todoItem = createTodoElement(todo);
    elements.todoList.appendChild(todoItem);
  });
}

// TODO要素を作成
function createTodoElement(todo) {
  const div = document.createElement("div");
  div.className = "todo-item";
  div.dataset.id = todo.id;

  // タイトルを取得
  const title = getTodoTitle(todo);

  // 完了状態を取得
  const isCompleted = getTodoStatus(todo);
  if (isCompleted) {
    div.classList.add("completed");
  }

  // 期限を取得
  const dueDate = getTodoDueDate(todo);

  // タグを取得
  const tags = getTodoTags(todo);
  
  // リレーションを取得
  const relations = getTodoRelations(todo);

  // メタ情報のHTML
  let metaHtml = "";
  if (dueDate || tags.length > 0 || relations.length > 0 || true) { // 常にメタエリアを表示
    metaHtml = '<div class="todo-meta">';

    if (dueDate) {
      const isOverdue = new Date(dueDate) < new Date() && !isCompleted;
      const dueDateClass = isOverdue ? "due-date overdue" : "due-date";
      metaHtml += `<span class="${dueDateClass}" data-edit-type="duedate">📅 ${formatDate(dueDate)}</span>`;
    } else {
      // 期日がない場合は「+ 期日」ボタンを表示
      metaHtml += '<span class="add-tag-btn" data-edit-type="duedate">+ 期日</span>';
    }

    // リレーション表示
    if (relations.length > 0) {
      relations.forEach((relId) => {
        const cached = pageTitleCache[relId] || "...";
        metaHtml += `<span class="relation-tag" data-rel-id="${relId}">${escapeHtml(cached)}</span>`;
      });
    }

    if (tags.length > 0) {
      tags.forEach((tag) => {
        metaHtml += `<span class="tag" data-edit-type="tag">${tag}</span>`;
      });
    }
    
    // タグ編集ボタン
    metaHtml += '<span class="add-tag-btn" data-edit-type="tag">+ タグ</span>';

    metaHtml += "</div>";
  }
  


  div.innerHTML = `
    <div class="todo-checkbox">
      <svg viewBox="0 0 24 24" fill="none">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <div class="todo-text">
      <div class="todo-content" contenteditable="true" spellcheck="false">${escapeHtml(title)}</div>
      ${metaHtml}
    </div>

  `;

  const checkbox = div.querySelector(".todo-checkbox");
  const todoContent = div.querySelector(".todo-content");

  // チェックボックスクリックで完了切り替え
  checkbox.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleTodo(todo.id, !isCompleted);
  });

  // タイトル編集の保存処理
  let isEditing = false;
  todoContent.addEventListener("focus", () => {
    isEditing = true;
  });

  todoContent.addEventListener("blur", () => {
    if (isEditing) {
      const newTitle = todoContent.textContent.trim();
      if (newTitle && newTitle !== title) {
        updateTodoTitle(todo.id, newTitle);
      } else {
        todoContent.textContent = title;
      }
      isEditing = false;
    }
  });




  todoContent.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      todoContent.blur();
    }
    if (e.key === "Escape") {
      todoContent.textContent = title;
      todoContent.blur();
    }
  });

  // 期日・タグ編集のクリックイベント
  const metaElements = div.querySelectorAll('[data-edit-type]');
  metaElements.forEach(element => {
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      const editType = element.dataset.editType;
      if (editType === 'duedate') {
        openDueDateModal(todo.id, dueDate);
      } else if (editType === 'tag') {
        openTagModal(todo.id, tags);
      }
    });
  });

  // リレーション名の非同期取得
  if (relations.length > 0) {
    relations.forEach(relId => {
      if (!pageTitleCache[relId]) {
        fetchPageTitle(relId).then(name => {
           if (name) {
             const relTags = div.querySelectorAll(`.relation-tag[data-rel-id="${relId}"]`);
             relTags.forEach(el => el.textContent = name);
           }
        });
      }
    });
  }

  return div;
}

// TODOのタイトルを更新
async function updateTodoTitle(todoId, newTitle) {
  try {
    // 対象のTODOを特定
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;

    const dbId = todo.parent.database_id;
    
    // スキーマを取得
    let schema = databaseSchemas[dbId];
    if (!schema) {
        schema = await getDatabaseSchema(dbId);
    }
    
    let titleKey = schema ? schema.titlePropertyName : null;
    
    if (!titleKey) {
        // フォールバック: プロパティをスキャン
        // データベース情報を取得
        const dbResponse = await fetch(
          `https://api.notion.com/v1/databases/${dbId}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Notion-Version": "2022-06-28",
            },
          },
        );

        if (!dbResponse.ok) throw new Error("DBプロパティの取得に失敗しました");
        const dbData = await dbResponse.json();
        
        for (const [name, prop] of Object.entries(dbData.properties)) {
          if (prop.type === "title") {
            titleKey = name;
            break;
          }
        }
    }

    const response = await fetch(`https://api.notion.com/v1/pages/${todoId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          [titleKey]: {
            title: [{ text: { content: newTitle } }],
          },
        },
      }),
    });

    if (!response.ok) throw new Error("タイトルの更新に失敗しました");

    // リロード
    await loadTodos();
  } catch (error) {
    showError(`更新エラー: ${error.message}`);
    await loadTodos();
  }
}

// タイトルを取得
function getTodoTitle(todo) {
  // 全プロパティから 'title' 型のものを探す（動的判別）
  for (const prop of Object.values(todo.properties)) {
    if (prop.type === "title" && prop.title && prop.title.length > 0) {
      return prop.title[0].plain_text;
    }
  }

  return "無題";
}

// 完了状態を取得（フィルタリング用）
function getTodoStatus(todo) {
  // スキーマを取得
  const dbId = todo.parent.database_id;
  const schema = databaseSchemas[dbId];

  if (schema) {
    // ステータスプロパティがある場合
    if (schema.statusPropertyName && schema.completedStatusNames) {
      const prop = todo.properties[schema.statusPropertyName];
      if (prop && prop.type === "status" && prop.status) {
        return schema.completedStatusNames.includes(prop.status.name);
      }
    }
    // チェックボックスプロパティがある場合
    if (schema.checkboxPropertyName) {
        const prop = todo.properties[schema.checkboxPropertyName];
        if (prop && prop.type === "checkbox") {
            return prop.checkbox;
        }
    }
  }

  // フォールバック: すべてのプロパティをスキャンして状態を探す
  for (const prop of Object.values(todo.properties)) {
    // ステータス型（最優先）
    if (prop.type === "status" && prop.status) {
      // 「完了」の場合は表示しない
      return prop.status.name === "完了" || prop.status.name === "Done" || prop.status.name === "Completed";
    }
    // チェックボックス型
    if (prop.type === "checkbox") {
      return prop.checkbox;
    }
  }

  return false;
}

// 期限を取得
function getTodoDueDate(todo) {
  // すべてのプロパティをスキャンして 'date' 型を探す
  for (const prop of Object.values(todo.properties)) {
    if (prop.type === "date" && prop.date) {
      return prop.date.start;
    }
  }
  return null;
}

// タグを取得
function getTodoTags(todo) {
  const allTags = [];

  // すべてのプロパティをスキャン
  for (const prop of Object.values(todo.properties)) {
    // マルチセレクト型
    if (prop.type === "multi_select" && prop.multi_select) {
      prop.multi_select.forEach((tag) => allTags.push(tag.name));
    }
    // セレクト型
    if (prop.type === "select" && prop.select) {
      allTags.push(prop.select.name);
    }
  }

  return allTags;
}

// 日付をフォーマット
function formatDate(dateString) {
  const date = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 日付のみを比較するために時刻を0にする
  const dateOnly = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const tomorrowOnly = new Date(
    tomorrow.getFullYear(),
    tomorrow.getMonth(),
    tomorrow.getDate(),
  );

  if (dateOnly.getTime() === todayOnly.getTime()) {
    return "今日";
  } else if (dateOnly.getTime() === tomorrowOnly.getTime()) {
    return "明日";
  } else {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  }
}

// TODOの完了状態を切り替え
async function toggleTodo(todoId, checked) {
  try {
    // まず、このTODOのプロパティ構造を確認
    const todo = todos.find((t) => t.id === todoId);
    if (!todo) return;

    // 更新するプロパティを決定
    let updateProps = {};

    // データベース情報を取得
    const dbId = todo.parent.database_id;
    let schema = databaseSchemas[dbId];
    if (!schema) {
        schema = await getDatabaseSchema(dbId);
    }

    // ステータス型があるか確認
    let statusKey = schema ? schema.statusPropertyName : null;
    let checkboxKey = schema ? schema.checkboxPropertyName : null;

    if (!statusKey && !checkboxKey) {
        // フォールバック: プロパティをスキャン
        for (const [key, value] of Object.entries(todo.properties)) {
          if (value.type === "status") statusKey = key;
          if (value.type === "checkbox") checkboxKey = key;
        }
    }

    if (statusKey) {
      // ステータスを「完了」に更新
      updateProps[statusKey] = {
        status: { name: checked ? "完了" : "未着手" },
      };
    } else if (checkboxKey) {
      // チェックボックスを更新
      updateProps[checkboxKey] = {
        checkbox: checked,
      };
    } else {
      showError("ステータスまたはチェックボックス属性が見つかりません");
      return;
    }

    // タスクを完了にする場合のみアニメーション処理
    if (checked) {
      // DOM要素を取得
      const todoElement = document.querySelector(`[data-id="${todoId}"]`);
      if (todoElement) {
        // まずcompletedクラスを追加（チェックマークアニメーション）
        todoElement.classList.add("completed");

        // 600ms後にフェードアウト開始
        setTimeout(() => {
          todoElement.classList.add("fade-out");

          // アニメーション完了後にDOMから削除（400ms）
          setTimeout(() => {
            todoElement.remove();
          }, 400);
        }, 600);
      }
    }

    // Notion APIを更新
    const response = await fetch(`https://api.notion.com/v1/pages/${todoId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: updateProps,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "更新に失敗しました");
    }

    // 未完了に戻す場合はリストを再読み込み
    if (!checked) {
      await loadTodos();
    }
  } catch (error) {
    showError(`エラー: ${error.message}`);
    console.error("Error toggling todo:", error);
    // エラー時はリストを再読み込み
    await loadTodos();
  }
}

// 新規タスクを追加
async function addTodo() {
  const title = elements.newTaskInput.value.trim();
  if (!title || !getActiveDatabaseId()) return;

  try {
    showLoading();

    // プロパティ情報を取得してタイトルとステータスのキーを特定
    const dbResponse = await fetch(
      `https://api.notion.com/v1/databases/${getActiveDatabaseId()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Notion-Version": "2022-06-28",
        },
      },
    );

    if (!dbResponse.ok) throw new Error("データベース情報の取得に失敗しました");
    const dbData = await dbResponse.json();

    let activeTitleKey = "Name";
    let activeStatusKey = null;

    for (const [name, prop] of Object.entries(dbData.properties)) {
      if (prop.type === "title") activeTitleKey = name;
      if (prop.type === "status") activeStatusKey = name;
    }

    // 更新用のプロパティを構築
    const properties = {
      [activeTitleKey]: {
        title: [{ text: { content: title } }],
      },
    };

    // ステータスプロパティがある場合は「未着手」をセット
    if (activeStatusKey) {
      properties[activeStatusKey] = {
        status: { name: "未着手" },
      };
    }

    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: getActiveDatabaseId() },
        properties: properties,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "タスクの追加に失敗しました");
    }

    elements.newTaskInput.value = "";
    await loadTodos();
  } catch (error) {
    hideLoading();
    showError(`エラー: ${error.message}`);
    console.error("Error adding todo:", error);
  }
}

// UI制御関数
function showSetupMessage() {
  elements.setupMessage.style.display = "block";
  elements.addTaskForm.style.display = "none";
  elements.todoList.style.display = "none";
}

function hideSetupMessage() {
  elements.setupMessage.style.display = "none";
  elements.addTaskForm.style.display = "flex";
  elements.todoList.style.display = "block";
}

function showLoading() {
  elements.loading.style.display = "flex";
}

function hideLoading() {
  elements.loading.style.display = "none";
}

function showMessage(message, type = 'error') {
  elements.errorMessage.textContent = message;
  elements.errorMessage.className = type === 'success' ? 'success-message' : 'error-message';
  elements.errorMessage.style.display = "block";
  
  if (type === 'success') {
    setTimeout(hideError, 3000);
  }
}

function showError(message) {
  showMessage(message, 'error');
}

function hideError() {
  elements.errorMessage.style.display = "none";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ========== 期日編集機能 ==========

// 期日編集モーダルを開く
function openDueDateModal(todoId, currentDate) {
  editingTodoId = todoId;
  const modal = document.getElementById('dueDateModal');
  const input = document.getElementById('dueDateInput');
  
  if (currentDate) {
    input.value = currentDate;
  } else {
    input.value = '';
  }
  
  modal.style.display = 'flex';
}

// リレーションIDを取得
function getTodoRelations(todo) {
  const relations = [];
  for (const prop of Object.values(todo.properties)) {
    if (prop.type === "relation" && prop.relation) {
      prop.relation.forEach(rel => relations.push(rel.id));
    }
  }
  return relations;
}

// ページタイトルを取得（キャッシュ付き）
async function fetchPageTitle(pageId) {
  if (pageTitleCache[pageId]) return pageTitleCache[pageId];
  if (pendingRequests[pageId]) return pendingRequests[pageId];

  const promise = (async () => {
    try {
      const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Notion-Version": "2022-06-28",
        },
      });

      if (!response.ok) return "Unknown";
      const data = await response.json();

      let title = "無題";
      for (const prop of Object.values(data.properties)) {
        if (prop.type === "title" && prop.title) {
          title = prop.title.map(t => t.plain_text).join("") || "無題";
          break;
        }
      }
      
      pageTitleCache[pageId] = title;
      return title;
    } catch (error) {
      console.error("Page fetch error:", error);
      return "Error";
    } finally {
      delete pendingRequests[pageId];
    }
  })();

  pendingRequests[pageId] = promise;
  return promise;
}

// 期日を保存
async function saveDueDate() {
  const input = document.getElementById('dueDateInput');
  const newDate = input.value;
  
  if (!newDate || !editingTodoId) return;
  
  try {
    showLoading();
    const schema = await getDatabaseSchema();
    
    if (!schema.datePropertyName) {
      throw new Error('日付プロパティが見つかりません');
    }
    
    const response = await fetch(`https://api.notion.com/v1/pages/${editingTodoId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          [schema.datePropertyName]: {
            date: { start: newDate }
          }
        }
      })
    });
    
    if (!response.ok) throw new Error('期日更新失敗');
    
    closeDueDateModal();
    await loadTodos();
  } catch (error) {
    hideLoading();
    showError(`エラー: ${error.message}`);
  }
}



// 期日を削除
async function removeDueDate() {
  if (!editingTodoId) return;
  
  try {
    showLoading();
    const schema = await getDatabaseSchema();
    
    if (!schema.datePropertyName) {
      throw new Error('日付プロパティが見つかりません');
    }
    
    const response = await fetch(`https://api.notion.com/v1/pages/${editingTodoId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          [schema.datePropertyName]: {
            date: null
          }
        }
      })
    });
    
    if (!response.ok) throw new Error('期日削除失敗');
    
    closeDueDateModal();
    await loadTodos();
  } catch (error) {
    hideLoading();
    showError(`エラー: ${error.message}`);
  }
}

function closeDueDateModal() {
  document.getElementById('dueDateModal').style.display = 'none';
  editingTodoId = null;
}

// ========== タグ編集機能 ==========

// タグ編集モーダルを開く
async function openTagModal(todoId, currentTags) {
  editingTodoId = todoId;
  
  try {
    const schema = await getDatabaseSchema();
    
    if (!schema.tagPropertyName) {
      showError('タグプロパティが見つかりません');
      return;
    }
    
    const modal = document.getElementById('tagModal');
    const container = document.getElementById('tagCheckboxes');
    container.innerHTML = '';
    
    // 利用可能なタグのチェックボックスを生成
    schema.availableTags.forEach(tag => {
      const label = document.createElement('label');
      label.className = 'tag-checkbox-label';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = tag;
      checkbox.checked = currentTags.includes(tag);
      
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(tag));
      container.appendChild(label);
    });
    
    modal.style.display = 'flex';
  } catch (error) {
    showError(`エラー: ${error.message}`);
  }
}

// タグを保存
async function saveTags() {
  if (!editingTodoId) return;
  
  try {
    showLoading();
    const schema = await getDatabaseSchema();
    
    if (!schema.tagPropertyName) {
      throw new Error('タグプロパティが見つかりません');
    }
    
    // 選択されたタグを取得
    const checkboxes = document.querySelectorAll('#tagCheckboxes input[type="checkbox"]');
    const selectedTags = Array.from(checkboxes)
      .filter(cb => cb.checked)
      .map(cb => ({ name: cb.value }));
    
    const response = await fetch(`https://api.notion.com/v1/pages/${editingTodoId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          [schema.tagPropertyName]: {
            multi_select: selectedTags
          }
        }
      })
    });
    
    if (!response.ok) throw new Error('タグ更新失敗');
    
    closeTagModal();
    await loadTodos();
  } catch (error) {
    hideLoading();
    showError(`エラー: ${error.message}`);
  }
}

function closeTagModal() {
  document.getElementById('tagModal').style.display = 'none';
  editingTodoId = null;
}


// イベントリスナー
elements.refreshBtn.addEventListener("click", loadTodos);
elements.settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
elements.openOptionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
elements.addTaskBtn.addEventListener("click", addTodo);
elements.newTaskInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    addTodo();
  }
});

// 期日モーダルのイベントリスナー
document.getElementById('saveDueDateBtn').addEventListener('click', saveDueDate);
document.getElementById('removeDueDateBtn').addEventListener('click', removeDueDate);
document.getElementById('cancelDueDateBtn').addEventListener('click', closeDueDateModal);

// タグモーダルのイベントリスナー
document.getElementById('saveTagBtn').addEventListener('click', saveTags);
document.getElementById('cancelTagBtn').addEventListener('click', closeTagModal);

// モーダル背景クリックで閉じる
document.getElementById('dueDateModal').addEventListener('click', (e) => {
  if (e.target.id === 'dueDateModal') closeDueDateModal();
});
document.getElementById('tagModal').addEventListener('click', (e) => {
  if (e.target.id === 'tagModal') closeTagModal();
});



// 初期化実行
init();
