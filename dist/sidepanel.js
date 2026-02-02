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

// キャッシュ
// キャッシュ
const userCache = {};
const pendingUserRequests = {};

// ユーザー情報を取得（キャッシュ対応・重複排除）
async function fetchUserProfile(userId) {
  if (userCache[userId]) return userCache[userId];
  if (pendingUserRequests[userId]) return pendingUserRequests[userId];

  const fetchPromise = (async () => {
    try {
      const response = await fetch(`https://api.notion.com/v1/users/${userId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Notion-Version": "2022-06-28",
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`User fetched: ${userId} -> ${data.name}`, data);
        const name = data.name || "Unknown";
        userCache[userId] = name;
        return name;
      } else {
        const errorText = await response.text();
        console.warn(`User fetch failed: ${response.status}`, errorText);
        // 権限エラーなどの場合は再試行しないようにキャッシュする
        if (response.status === 403 || response.status === 404) {
           userCache[userId] = "User"; // キャッシュして次回以降スキップ
           return "User";
        }
      }
    } catch (error) {
      console.error("Error fetching user profile:", error);
    }
    return null;
  })();

  pendingUserRequests[userId] = fetchPromise;

  try {
    return await fetchPromise;
  } finally {
    delete pendingUserRequests[userId];
  }
}

// ロールアップから値を抽出するヘルパー
function getRollupValue(rollup) {
  if (!rollup) return null;
  
  if (rollup.type === "array") {
    // 配列内の各要素から値を抽出して結合
    return rollup.array.map(item => {
      if (item.type === "title" && item.title) return item.title.map(t => t.plain_text).join("");
      if (item.type === "rich_text" && item.rich_text) return item.rich_text.map(t => t.plain_text).join("");
      if (item.type === "people" && item.people) return item.people.name || "User";
      if (item.type === "select" && item.select) return item.select.name;
      if (item.type === "multi_select" && item.multi_select) return item.multi_select.map(o => o.name).join(", ");
      if (item.type === "date" && item.date) return formatDate(item.date.start);
      if (item.type === "number" && item.number) return item.number;
      if (item.type === "url" && item.url) return item.url;
      if (item.type === "email" && item.email) return item.email;
      if (item.type === "phone_number" && item.phone_number) return item.phone_number;
      return "";
    }).filter(v => v !== "").join(", ");
  }
  
  if (rollup.type === "date" && rollup.date) return formatDate(rollup.date.start);
  if (rollup.type === "number" && rollup.number) return rollup.number;
  
  return null;
}

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
      showAllDatabases = false;
    } else {
      // 保存されたIDがない場合は最初のDBを選択
      config.activeDatabaseId = config.databases[0].id;
      elements.dbSelector.value = config.databases[0].id;
      showAllDatabases = false;
    }

    hideSetupMessage();
    await loadTodos();
  });
}

// セレクターUIの描画
function renderDbSelector() {
  elements.dbSelector.innerHTML = "";
  
  // 「すべて表示」オプションを追加
  const allOption = document.createElement("option");
  allOption.value = "__ALL__";
  allOption.textContent = "📋 すべて表示";
  elements.dbSelector.appendChild(allOption);
  
  // 各データベースのオプションを追加
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
  
  // 「すべて表示」が選択された場合
  if (newId === "__ALL__") {
    showAllDatabases = true;
    config.activeDatabaseId = ""; // アクティブDBをクリア
  } else {
    showAllDatabases = false;
    config.activeDatabaseId = newId;
    chrome.storage.sync.set({ activeDatabaseId: newId });
  }
  
  titlePropertyName = ""; // キャッシュをクリア
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
// const pageTitleCache = {}; // Removed duplicate definition
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

  // このTODOが属するデータベースの表示設定を取得
  const dbId = todo.parent.database_id;
  const db = config.databases.find(d => d.id === dbId);
  
  // visiblePropertiesを取得(後方互換性のため、displaySettingsも考慮)
  let visibleProperties = db?.visibleProperties;
  
  // 後方互換性: displaySettingsが存在する場合は全プロパティを表示
  if (!visibleProperties && db?.displaySettings) {
    visibleProperties = null; // nullの場合は全プロパティ表示
  }
  
  // プロパティが表示可能かチェックする関数
  const isPropertyVisible = (propName) => {
    if (!visibleProperties) return true; // 設定がない場合は全表示
    return visibleProperties.includes(propName);
  };

  // 各プロパティを取得(プロパティ名も一緒に)
  const properties = {};
  
  for (const [propName, prop] of Object.entries(todo.properties)) {
    if (prop.type === 'date' && prop.date) {
      properties[propName] = { type: 'date', value: prop.date.start };
    } else if ((prop.type === 'multi_select' || prop.type === 'select') && (prop.multi_select || prop.select)) {
      const tags = prop.type === 'multi_select' 
        ? prop.multi_select.map(t => t.name)
        : [prop.select.name];
      properties[propName] = { type: 'tags', value: tags };

    } else if (prop.type === 'rich_text' && prop.rich_text && prop.rich_text.length > 0) {
      properties[propName] = { type: 'rich_text', value: prop.rich_text[0].plain_text };
    } else if (prop.type === 'number' && prop.number !== null) {
      properties[propName] = { type: 'number', value: prop.number };
    } else if (prop.type === 'people' && prop.people && prop.people.length > 0) {
      // ユーザーIDも含めて保存
      const people = prop.people.map(p => ({
        id: p.id,
        name: p.name || (p.object === 'user' ? 'User' : 'Unknown'),
        needsFetch: !p.name && p.object === 'user' // 名前がなくUserオブジェクトならフェッチ対象
      }));
      properties[propName] = { type: 'people', value: people };
    } else if (prop.type === 'url' && prop.url) {
      properties[propName] = { type: 'url', value: prop.url };
    } else if (prop.type === 'rollup' && prop.rollup) {
      const value = getRollupValue(prop.rollup);
      if (value) {
        properties[propName] = { type: 'rollup', value: value };
      }
    } else if (prop.type === 'checkbox') {
      // 完了フラグ用のチェックボックスは除外（名前で判定）
      const isStatusCheckbox = ['Done', '完了', 'Completed', 'Finished'].some(name => 
        name.toLowerCase() === propName.toLowerCase()
      );
      
      if (!isStatusCheckbox && prop.checkbox) {
         properties[propName] = { type: 'checkbox', value: true };
      }
    }
  }

  // メタ情報のHTML
  let metaHtml = "";
  if (Object.keys(properties).length > 0 || true) {
    metaHtml = '<div class="todo-meta">';

    // 各プロパティを表示
    for (const [propName, propData] of Object.entries(properties)) {
      if (!isPropertyVisible(propName)) continue;
      
      if (propData.type === 'date') {
        const isOverdue = new Date(propData.value) < new Date() && !isCompleted;
        const dueDateClass = isOverdue ? "due-date overdue" : "due-date";
        metaHtml += `<span class="${dueDateClass}" data-edit-type="duedate">📅 ${formatDate(propData.value)}</span>`;
      } else if (propData.type === 'tags') {
        propData.value.forEach((tag) => {
          metaHtml += `<span class="tag" data-edit-type="tag">${tag}</span>`;
        });

      } else if (propData.type === 'rich_text') {
        metaHtml += `<span class="rich-text-tag">📝 ${escapeHtml(propData.value)}</span>`;
      } else if (propData.type === 'number') {
        metaHtml += `<span class="number-tag">🔢 ${propData.value}</span>`;
      } else if (propData.type === 'people') {
        propData.value.forEach((person) => {
          const fetchAttr = person.needsFetch ? ` data-needs-fetch="true" data-user-id="${person.id}"` : '';
          metaHtml += `<span class="people-tag"${fetchAttr}>👤 ${escapeHtml(person.name)}</span>`;
        });
      } else if (propData.type === 'url') {
        const shortUrl = propData.value.length > 30 ? propData.value.substring(0, 30) + "..." : propData.value;
        metaHtml += `<a href="${propData.value}" target="_blank" class="url-tag" title="${propData.value}">📎 ${escapeHtml(shortUrl)}</a>`;
      } else if (propData.type === 'rollup') {
        const shortValue = propData.value.length > 20 ? propData.value.substring(0, 20) + "..." : propData.value;
        metaHtml += `<span class="tag rollup-tag" title="${escapeHtml(propData.value)}">🔗 ${escapeHtml(shortValue)}</span>`;
      } else if (propData.type === 'checkbox') {
        metaHtml += `<span class="checkbox-tag">✅ ${escapeHtml(propName)}</span>`;
      }
    }

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

  // イベントリスナー用に変数を準備
  let dueDate = null;
  let tags = [];

  let people = [];

  // propertiesから値を抽出
  for (const [key, data] of Object.entries(properties)) {
    if (data.type === 'date') dueDate = data.value;
    else if (data.type === 'tags') tags = data.value;

    else if (data.type === 'people') people = people.concat(data.value);
  }

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



  // 担当者名の非同期取得 (NEW)
  if (people.length > 0) {
    people.forEach(person => {
      if (person.needsFetch) {
        fetchUserProfile(person.id).then(name => {
          if (name) {
            const peopleTags = div.querySelectorAll(`.people-tag[data-user-id="${person.id}"]`);
            peopleTags.forEach(el => el.textContent = `👤 ${name}`);
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

// リレーションを取得
function getTodoRelations(todo) {
  const relations = [];
  for (const prop of Object.values(todo.properties)) {
    if (prop.type === "relation" && prop.relation) {
      prop.relation.forEach((rel) => relations.push(rel.id));
    }
  }
  return relations;
}

// リッチテキストを取得
function getTodoRichText(todo) {
  for (const prop of Object.values(todo.properties)) {
    if (prop.type === "rich_text" && prop.rich_text && prop.rich_text.length > 0) {
      return prop.rich_text[0].plain_text;
    }
  }
  return null;
}

// 数値を取得
function getTodoNumber(todo) {
  for (const prop of Object.values(todo.properties)) {
    if (prop.type === "number" && prop.number !== null) {
      return prop.number;
    }
  }
  return null;
}

// 担当者を取得
function getTodoPeople(todo) {
  const people = [];
  for (const prop of Object.values(todo.properties)) {
    if (prop.type === "people" && prop.people) {
      prop.people.forEach((person) => {
        people.push(person.name || person.email || "Unknown");
      });
    }
  }
  return people;
}

// URLを取得
function getTodoUrl(todo) {
  for (const prop of Object.values(todo.properties)) {
    if (prop.type === "url" && prop.url) {
      return prop.url;
    }
  }
  return null;
}

// チェックボックスを取得（完了状態以外のチェックボックス）
function getTodoCheckboxes(todo) {
  const checkboxes = [];
  for (const [name, prop] of Object.entries(todo.properties)) {
    // 完了状態として使われているチェックボックスは除外
    if (prop.type === "checkbox" && !["Done", "完了", "Completed"].includes(name)) {
      if (prop.checkbox) {
        checkboxes.push(name);
      }
    }
  }
  return checkboxes;
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
