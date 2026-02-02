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



// ロールアップから値を抽出するヘルパー
// ロールアップから値を抽出するヘルパー
function getRollupValue(rollup) {
  if (!rollup) return null;

  // 配列型の処理 (show_originalの場合など)
  if (rollup.type === "array") {
    return rollup.array.map(item => {
      if (item.type === "title" && item.title) return item.title.map(t => t.plain_text).join("");
      if (item.type === "rich_text" && item.rich_text) return item.rich_text.map(t => t.plain_text).join("");
      if (item.type === "people" && item.people) return item.people.name || "User";
      if (item.type === "select" && item.select) return item.select.name;
      if (item.type === "multi_select" && item.multi_select) return item.multi_select.map(o => o.name).join(", ");
      if (item.type === "status" && item.status) return item.status.name;
      if (item.type === "date" && item.date) return formatDate(item.date.start);
      if (item.type === "number" && item.number !== null) return item.number;
      if (item.type === "url" && item.url) return item.url;
      if (item.type === "email" && item.email) return item.email;
      if (item.type === "phone_number" && item.phone_number) return item.phone_number;
      if (item.type === "checkbox") return item.checkbox ? "✅" : "⬜";
      if (item.type === "files" && item.files) return item.files.length > 0 ? "📎" : "";
      
      // Formulaの処理
      if (item.type === "formula" && item.formula) {
        if (item.formula.type === "string") return item.formula.string;
        if (item.formula.type === "number") return item.formula.number;
        if (item.formula.type === "boolean") return item.formula.boolean;
        if (item.formula.type === "date") return formatDate(item.formula.date.start);
      }
      
      return "";
    }).filter(v => v !== "" && v !== null && v !== undefined).join(", ");
  }

  // 単一値の処理 (計算結果など)
  if (rollup.type === "date" && rollup.date) return formatDate(rollup.date.start);
  if (rollup.type === "number" && rollup.number !== null) return rollup.number;
  if (rollup.type === "incomplete") return null; // 計算中の場合など

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
  chrome.storage.local.get(["activeDatabaseId"], async (save) => {
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
    chrome.storage.local.set({ activeDatabaseId: newId });
  }
  
  titlePropertyName = ""; // キャッシュをクリア
  await loadTodos();
});

// 設定を読み込む
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
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
let editingPropName = null; // 現在編集中のプロパティ名
let currentPeopleIds = []; // 編集中の担当者IDリスト（編集用一時保存）
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
// TODOを読み込む
async function loadTodos() {
  // 設定を最新化 (syncストレージから読み込み)
  await new Promise((resolve) => {
    chrome.storage.local.get(['notionApiKey', 'notionDatabases', 'notionActiveDatabaseId'], (result) => {
      if (result.notionApiKey) config.apiKey = result.notionApiKey;
      if (result.notionDatabases) config.databases = result.notionDatabases;
      // アクティブDBのIDが未設定ならロードしたものを使う
      if (result.notionActiveDatabaseId && !config.activeDatabaseId) {
        config.activeDatabaseId = result.notionActiveDatabaseId;
      }
      resolve();
    });
  });

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
      
      // 1. 完了状態でソート (未完了が先)
      if (aDone !== bDone) {
        return aDone ? 1 : -1;
      }
      
      // 2. 期限でソート (近い順)
      const aDate = getTodoDueDate(a);
      const bDate = getTodoDueDate(b);
      
      if (aDate && bDate) {
        // 日付文字列同士の比較でもよいが、Dateオブジェクトにして差分を取るのが確実
        return new Date(aDate) - new Date(bDate);
      }
      if (aDate) return -1; // 期限ありを優先(上へ)
      if (bDate) return 1;
      
      // 3. 作成日時でソート (新しい順)
      return new Date(b.created_time) - new Date(a.created_time);
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
    // フィルターの構築
    const dbConfig = config.databases.find(d => d.id.replace(/-/g, '') === dbId.replace(/-/g, ''));
    const filter = dbConfig ? buildNotionFilter(dbConfig) : undefined;
    
    const requestBody = {
      sorts: [
        {
          timestamp: "created_time",
          direction: "descending",
        },
      ],
    };
    
    if (filter) {
      requestBody.filter = filter;
    }

    const response = await fetch(
      `https://api.notion.com/v1/databases/${dbId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
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
  const db = config.databases.find(d => d.id.replace(/-/g, '') === dbId.replace(/-/g, ''));
  
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
    if (prop.type === 'date') {
      properties[propName] = { type: 'date', value: prop.date ? prop.date.start : null };
    } else if (prop.type === 'multi_select' || prop.type === 'select') {
      let tags = [];
       if (prop.type === 'multi_select' && prop.multi_select) {
          tags = prop.multi_select.map(t => t.name);
       } else if (prop.type === 'select' && prop.select) {
          tags = [prop.select.name];
       }
       properties[propName] = { type: 'tags', value: tags.length > 0 ? tags : null };
    
    } else if (prop.type === 'rich_text' && prop.rich_text && prop.rich_text.length > 0) {
      properties[propName] = { type: 'rich_text', value: prop.rich_text[0].plain_text };
    } else if (prop.type === 'number' && prop.number !== null) {
      properties[propName] = { type: 'number', value: prop.number };
    } else if (prop.type === 'people') {
      let people = [];
      if (prop.people && prop.people.length > 0) {
         people = prop.people.map(p => ({
           id: p.id,
           name: p.name || (p.object === 'user' ? 'User' : 'Unknown')
         }));
      }
      properties[propName] = { type: 'people', value: people.length > 0 ? people : null };
    } else if (prop.type === 'url' && prop.url) {
      properties[propName] = { type: 'url', value: prop.url };
    } else if (prop.type === 'rollup' && prop.rollup) {
      const value = getRollupValue(prop.rollup);
      if (value !== null && value !== undefined && value !== "") {
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
        if (propData.value) {
          const isOverdue = new Date(propData.value) < new Date() && !isCompleted;
          const dueDateClass = isOverdue ? "due-date overdue" : "due-date";
          metaHtml += `<span class="${dueDateClass}" data-edit-type="duedate" data-edit-prop="${propName}">📅 ${formatDate(propData.value)}</span>`;
        } else {
           metaHtml += `<span class="add-prop-btn" data-edit-type="duedate" data-edit-prop="${propName}">📅 +</span>`;
        }
      } else if (propData.type === 'tags') {
        if (propData.value) {
          propData.value.forEach((tag) => {
            metaHtml += `<span class="tag" data-edit-type="tag" data-edit-prop="${propName}">${tag}</span>`;
          });
        } else {
           metaHtml += `<span class="add-prop-btn" data-edit-type="tag" data-edit-prop="${propName}">🏷️ +</span>`;
        }

      } else if (propData.type === 'rich_text') {
        metaHtml += `<span class="rich-text-tag">📝 ${escapeHtml(propData.value)}</span>`;
      } else if (propData.type === 'number') {
        metaHtml += `<span class="number-tag">🔢 ${propData.value}</span>`;
      } else if (propData.type === 'people') {
        if (propData.value) {
          propData.value.forEach((person) => {
            metaHtml += `<span class="people-tag" data-edit-type="people" data-edit-prop="${propName}">👤 ${escapeHtml(person.name)}</span>`;
          });
        } else {
           metaHtml += `<span class="add-prop-btn" data-edit-type="people" data-edit-prop="${propName}">👤 +</span>`;
        }
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
    <div class="todo-text">
      <div class="todo-content" contenteditable="true" spellcheck="false">${escapeHtml(title)}</div>
      ${metaHtml}
    </div>
    <button class="done-btn">完了</button>
  `;

  const doneBtn = div.querySelector(".done-btn");
  const todoContent = div.querySelector(".todo-content");

  // 完了ボタンクリックで完了切り替え
  doneBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // 誤タップ防止のため、確認ダイアログを出すか？-> UX重視ならトーストでUndoさせるのが良いが今回は即実行
    // ボタン化することで誤タップは減るはず。
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



  // propertiesから値を抽出
  for (const [key, data] of Object.entries(properties)) {
    if (data.type === 'date') dueDate = data.value;
    else if (data.type === 'tags') tags = data.value;


  }

  // 期日・タグ編集のクリックイベント
  const metaElements = div.querySelectorAll('[data-edit-type]');
  metaElements.forEach(element => {
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      const editType = element.dataset.editType;
      const propName = element.dataset.editProp;
      
      if (editType === 'duedate') {
        openDueDateModal(todo.id, dueDate, propName); // propNameを追加
      } else if (editType === 'tag') {
        openTagModal(todo.id, propName);
      } else if (editType === 'people') {
        openPeopleModal(todo.id, propName);
      }
    });
  });





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
function openDueDateModal(todoId, currentDate, propName) {
  editingTodoId = todoId;
  editingPropName = propName; // グローバル変数にセット
  
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


// 期日を保存

    
// 共通レンダーヘッダー
function updateTodoDateDOM(todoId, newDate) {
  const todoEl = document.querySelector(`.todo-item[data-id="${todoId}"]`);
  if (!todoEl) return;
  
  // 既存の日付タグを探す
  let dateTag = todoEl.querySelector('[data-edit-type="duedate"]');
  const propName = dateTag ? dateTag.dataset.editProp : null;
  
  // プロパティ名が分からない場合（まだタグがない場合など）、再描画したほうが安全だが
  // 今回は簡易的にメタエリアに追加または更新する。
  // しかしプロパティ名が必要。editingPropNameがあるはず。
  
  // 既存タグがあれば内容更新
  if (dateTag) {
     if (newDate) {
       dateTag.innerHTML = `📅 ${formatDate(newDate)}`;
       // Overdue check
       const isOverdue = new Date(newDate) < new Date();
       dateTag.className = isOverdue ? "due-date overdue" : "due-date";
     } else {
       // 日付削除されたら + ボタンに戻す
       const prop = dateTag.dataset.editProp;
       // outerHTMLで置換
       dateTag.outerHTML = `<span class="add-prop-btn" data-edit-type="duedate" data-edit-prop="${prop}">📅 +</span>`;
       // イベントリスナーが消えるので再付与が必要だが、親のイベントデリゲーションがないため
       // createTodoElement内で個別に付与している。
       // したがって、個別に付与しなおす必要がある。
       // これは面倒なので、いっそそのTodoだけ再レンダリングする関数を作る方が良いが、
       // ここでは簡易的に、リスト全体のリロードの代わりに「このTodoだけデータ更新して再描画」する戦略をとるべきか？
       // データ更新するには todos 配列を更新する必要がある。
     }
  } else {
     // +ボタンだった場合
     const addBtn = todoEl.querySelector(`.add-prop-btn[data-edit-type="duedate"]`);
     if (addBtn && newDate) {
        const prop = addBtn.dataset.editProp;
        const isOverdue = new Date(newDate) < new Date();
        const cls = isOverdue ? "due-date overdue" : "due-date";
        const newTagHtml = `<span class="${cls}" data-edit-type="duedate" data-edit-prop="${prop}">📅 ${formatDate(newDate)}</span>`;
        addBtn.outerHTML = newTagHtml;
     }
  }
  
  // Listener再付与が面倒なので、DOM更新後にクリックイベントが動かなくなる可能性がある。
  // createTodoElementの実装を見ると、`metaElements.forEach...` で付与している。
  // ここで置換してしまうとイベントが消える。
  // 解決策: 親要素(todo-meta)にデリゲートするか、置換後にリスナーを付ける。
  // 今回はリスナーを付け直す処理を入れる。
  reattachMetaListeners(todoEl);
}

function reattachMetaListeners(todoEl) {
    const metaElements = todoEl.querySelectorAll('[data-edit-type]');
    metaElements.forEach(element => {
      // 既存のリスナーを削除するのは難しいので、クローンして置換することで削除
      const newEl = element.cloneNode(true);
      element.parentNode.replaceChild(newEl, element);
      
      newEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const editType = newEl.dataset.editType;
        const propName = newEl.dataset.editProp;
        const todoId = todoEl.dataset.id; // 要素から取得
        const todo = todos.find(t => t.id === todoId); // 最新のtodosを参照
        
        if (editType === 'duedate') {
            // 日付はtodos内の値を参照するが、DOM更新のみでtodos更新していない場合ズレる。
            // なのでtodosも更新する必要がある。
            // updateTodoDateInList関数でtodosも更新する。
            const currentVal = todo.properties[propName]?.date?.start || null;
            openDueDateModal(todoId, currentVal); 
        } else if (editType === 'tag') {
          openTagModal(todoId, propName);
        } else if (editType === 'people') {
          openPeopleModal(todoId, propName);
        }
      });
    });
}

// 配列内のデータを更新するヘルパー
function updateLocalTodoData(todoId, propName, type, value) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    
    if (!todo.properties[propName]) {
        // プロパティ自体がない場合のコンストラクタ的な処理が必要だが
        // 通常はキーはある。
        todo.properties[propName] = {};
    }
    
    if (type === 'date') {
        todo.properties[propName] = { type: 'date', date: value ? { start: value } : null };
    } else if (type === 'people') {
       todo.properties[propName] = { type: 'people', people: value }; // value is array of objects
    } else if (type === 'tags') {
       // tagsの場合は select/multi_select で構造が違うので注意
       // saveTags側で適切に処理する必要がある
    }
}


// 期日を保存
async function saveDueDate() {
  const input = document.getElementById('dueDateInput');
  const newDate = input.value; // YYYY-MM-DD
  const btn = document.getElementById('saveDueDateBtn');
  
  if (!editingTodoId) return;
  
  const originalText = btn.textContent;
  btn.textContent = '保存中...';
  btn.disabled = true;
  
  try {
    const schema = await getDatabaseSchema();
    // 日付プロパティ名は editingPropName から取得すべきだが、modalを開くときに渡していない？
    // openDueDateModal は (todoId, currentDate) しか受け取っていない。
    // しかし createTodoElement では data-edit-prop を渡しているのに。
    // openDueDateModal も改修して propName を受け取るようにすべき。
    // 現状の実装: schema.datePropertyName を使っている (L1168)。
    // これだと複数の日付プロパティがある場合にバグる。
    // 今回の修正で openDueDateModal も propName を受け取るように変更する。
    
    if (!schema.datePropertyName) {
      throw new Error('日付プロパティが見つかりません');
    }
    
    // editingPropName が null の場合（古いコード経由）、schemaから推測
    const targetProp = editingPropName || schema.datePropertyName;
    
    const response = await fetch(`https://api.notion.com/v1/pages/${editingTodoId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          [targetProp]: {
            date: newDate ? { start: newDate } : null
          }
        }
      })
    });
    
    if (!response.ok) throw new Error('期日更新失敗');
    
    // 成功したらDOMと内部データを更新
    updateLocalTodoData(editingTodoId, targetProp, 'date', newDate);
    updateTodoDateDOM(editingTodoId, newDate);
    
    closeDueDateModal();
    // await loadTodos(); // 遅延の原因なので削除
    
  } catch (error) {
    showError(`エラー: ${error.message}`);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
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
async function openTagModal(todoId, propName) {
  editingTodoId = todoId;
  editingPropName = propName;
  
  try {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;

    // 現在のタグを取得
    let currentTags = [];
    const prop = todo.properties[propName];
    if (prop) {
      if (prop.type === 'multi_select' && prop.multi_select) {
        currentTags = prop.multi_select.map(t => t.name);
      } else if (prop.type === 'select' && prop.select) {
        currentTags = [prop.select.name];
      }
    }

    const dbId = todo.parent.database_id;
    let schema = databaseSchemas[dbId];
    if (!schema) schema = await getDatabaseSchema(dbId);
    
    // プロパティ定義から選択肢を取得
    const propDef = schema.properties[propName];
    if (!propDef) {
       showError('プロパティ定義が見つかりません');
       return;
    }

    let availableTags = [];
    if (propDef.type === 'multi_select') {
      availableTags = propDef.multi_select.options.map(o => o.name);
    } else if (propDef.type === 'select') {
      availableTags = propDef.select.options.map(o => o.name);
    }

    const modal = document.getElementById('tagModal');
    const container = document.getElementById('tagCheckboxes');
    container.innerHTML = '';
    
    // 利用可能なタグのチェックボックスを生成
    availableTags.forEach(tag => {
      const label = document.createElement('label');
      label.className = 'tag-checkbox-label';
      // Select型の場合はラジオボタン風の挙動にしたいが、UIはチェックボックスで統一し、JSで制御
      // 今回はシンプルに複数選択UIとする
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = tag;
      checkbox.checked = currentTags.includes(tag);
      
      // Select型の場合は単一選択にするためのリスナー
      if (propDef.type === 'select') {
         checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
               // 他を外す
               container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                  if (cb !== e.target) cb.checked = false;
               });
            }
         });
      }
      
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
  if (!editingTodoId || !editingPropName) return;
  
  const btn = document.getElementById('saveTagBtn');
  const originalText = btn.textContent;
  btn.textContent = '保存中...';
  btn.disabled = true;

  try {
    // showLoading(); // モーダル内ローディングに変更
    
    // 選択されたタグを取得
    const checkboxes = document.querySelectorAll('#tagCheckboxes input[type="checkbox"]');
    const selectedTags = Array.from(checkboxes)
      .filter(cb => cb.checked)
      .map(cb => ({ name: cb.value }));
    
    // 現在のTODO情報を取得してプロパティタイプを確認
    const todo = todos.find(t => t.id === editingTodoId);
    const propType = todo.properties[editingPropName].type;

    let updateBody = {};
    if (propType === 'select') {
       updateBody = {
          select: selectedTags.length > 0 ? selectedTags[0] : null
       };
    } else {
       updateBody = {
          multi_select: selectedTags
       };
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
          [editingPropName]: updateBody
        }
      })
    });
    
    if (!response.ok) throw new Error('タグ更新失敗');
    
    closeTagModal();
    await loadTodos(); // タグの場合はDOM更新が複雑（色情報の欠落など）なので、一旦リロードのままにするか、色情報をキャッシュしていればJS更新可能。
    // 今回は日付のラグが主訴なので、タグはリロードのままで進めるが、ローディングUIは改善する。
    
  } catch (error) {
    showError(`エラー: ${error.message}`);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function closeTagModal() {
  document.getElementById('tagModal').style.display = 'none';
  editingTodoId = null;
  editingPropName = null;
}

// ========== 担当者編集機能 ==========

// 担当者モーダルを開く
async function openPeopleModal(todoId, propName) {
  editingTodoId = todoId;
  editingPropName = propName;
  
  try {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    
    const dbId = todo.parent.database_id;
    // DB設定からユーザーリストを取得
    const dbConfig = config.databases.find(d => d.id.replace(/-/g, '') === dbId.replace(/-/g, ''));
    let users = dbConfig && dbConfig.users ? dbConfig.users : [];
    
    // 現在の担当者を取得
    currentPeopleIds = [];
    const prop = todo.properties[propName];
    if (prop && prop.people) {
       currentPeopleIds = prop.people.map(p => p.id);
    }

    const modal = document.getElementById('peopleModal');
    const container = document.getElementById('peopleCheckboxes');
    const searchInput = document.getElementById('peopleSearchInput');
    
    searchInput.value = ''; // リセット
    
    // レンダリング関数
    const renderList = (filterText = '') => {
      container.innerHTML = '';
      
      // 入力がない場合（かつ未選択）は何も表示しない、または「検索してください」と表示
      // ただし、既に担当者が設定されている場合はその人だけ表示する？
      // 要望によると「候補は出さずに入力後にマッチ思想な人だけを表示」とのこと。
      // なので、空文字の場合は空にする。ただし、現在選択中のユーザーは表示しておきたいかも？
      // 今回はシンプルに「入力がある場合のみ表示」にする。
      
      const lowerFilter = filterText.toLowerCase();
      
      /*
      // 初期表示（入力なし）の場合
      if (!filterText) {
         // 現在選択されているユーザーだけ表示する
         const selectedUsers = users.filter(u => currentPoolIds.includes(u.id));
         if (selectedUsers.length > 0) {
            // selectedUsersを表示...
            // （コード重複を避けるため下のループを使うが、フィルタリング条件を変える）
         } else {
            container.innerHTML = '<p style="color:#666; font-size:12px; padding:8px;">名前を入力して検索...</p>';
            return;
         }
      }
      */
      
      // フィルタリング処理
      // 1. 選択済みのユーザー（常に表示）
      // 2. 検索条件にマッチするユーザー（選択済み以外）
      
      const selectedUsers = users.filter(u => currentPeopleIds.includes(u.id));
      const matchedUsers = filterText 
          ? users.filter(u => !currentPeopleIds.includes(u.id) && u.name.toLowerCase().includes(lowerFilter))
          : []; // 入力がない場合は選択済み以外は表示しない（パフォーマンス対策）
      
      // 表示リストを作成（重複なし）
      // 選択済みユーザーは常に先頭に表示
      const displayUsers = [...selectedUsers, ...matchedUsers];
      
      // 最大表示数制限（選択済みは全て出す、検索結果は絞る）
      const maxDisplay = 50;
      if (displayUsers.length > maxDisplay) {
         displayUsers.length = maxDisplay; 
      }
      
      displayUsers.forEach(user => {
        const label = document.createElement('label');
        label.className = 'tag-checkbox-label'; // スタイル流用
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = user.id;
        checkbox.dataset.name = user.name;
        // データソースからチェック状態を判定するのではなく、
        // DOM上の（ユーザーが変更中の）状態を維持する必要があるが、
        // ここは renderList が呼ばれるたびに再生成されるため、
        // currentPoolIds だけでなく、現在チェックされている状態も反映させる必要がある？
        // いや、currentPoolIds は初期値だが、ユーザーが操作した内容はどこにある？
        // チェックボックスの状態が変わったら currentPoolIds も更新すべきか？
        // あるいは renderList を呼ぶ前（検索入力時）に、現在のチェック状態を currentPoolIds にマージする？
        
        // 修正案:
        // checkbox.addEventListener('change') で currentPeopleIds をリアルタイム更新するようにする。
        // そうすれば再描画されても checked 状態が維持される。
        checkbox.checked = currentPeopleIds.includes(user.id);
        
        checkbox.addEventListener('change', (e) => {
           if (e.target.checked) {
              if (!currentPeopleIds.includes(user.id)) currentPeopleIds.push(user.id);
           } else {
              currentPeopleIds = currentPeopleIds.filter(id => id !== user.id);
           }
           // チェック変更時にはリストを再描画しない（操作感を損なうため）
           // 検索入力時にだけ再描画される
        });
        
        const avatar = document.createElement('span');
        avatar.textContent = '👤 ';
        avatar.style.marginRight = '4px';
        
        label.appendChild(checkbox);
        label.appendChild(avatar);
        label.appendChild(document.createTextNode(user.name));
        container.appendChild(label);
      });
      
      if (container.children.length === 0) {
         if (users.length === 0) {
            container.innerHTML = `
              <div style="padding:12px; color:#b45309; background:#fffbeb; border-radius:8px; font-size:12px; line-height:1.5;">
                <p style="margin-bottom:8px; font-weight:bold;">⚠️ ユーザー情報がありません</p>
                <p>設定画面を開き、右上の<br><b>「🔄 更新」ボタン</b>を押してください。</p>
              </div>`;
         } else {
            container.innerHTML = '<p style="color:#888; font-size:12px; padding:8px;">ユーザーが見つかりません</p>';
         }
      }
    };
    
    renderList();
    
    // 検索イベント
    searchInput.oninput = (e) => renderList(e.target.value);
    
    modal.style.display = 'flex';
    searchInput.focus();
    
  } catch (error) {
    showError(`エラー: ${error.message}`);
  }
}

// 担当者を保存
async function savePeople() {
  if (!editingTodoId || !editingPropName) return;
  
  const btn = document.getElementById('savePeopleBtn');
  const originalText = btn.textContent;
  btn.textContent = '保存中...';
  btn.disabled = true;

  try {
    // showLoading();
    
    const checkboxes = document.querySelectorAll('#peopleCheckboxes input[type="checkbox"]'); // これは使わず currentPeopleIds を使う
    
    const selectedPeople = currentPeopleIds.map(id => ({ id: id }));
    
    const response = await fetch(`https://api.notion.com/v1/pages/${editingTodoId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          [editingPropName]: {
            people: selectedPeople
          }
        }
      })
    });
    
    if (!response.ok) throw new Error('担当者更新失敗');
    
    closePeopleModal();
    await loadTodos(); // PersonもDOM更新がややこしい（アバター画像は無いが）ので一旦リロード。
    // 時間があればここもOptimistic UIにするが、まずは要望の強い日付を優先。
    
  } catch (error) {
    showError(`エラー: ${error.message}`);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function closePeopleModal() {
  document.getElementById('peopleModal').style.display = 'none';
  editingTodoId = null;
  editingPropName = null;
}

// ユーザー一覧を強制更新
async function refreshUsers() {
  const btn = document.getElementById('refreshPeopleBtn');
  const originalContent = btn.innerHTML;
  btn.innerHTML = '<div class="spinner" style="width:14px; height:14px; border-width:2px;"></div>';
  btn.disabled = true;
  
  try {
    const response = await fetch('https://api.notion.com/v1/users', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Notion-Version': '2022-06-28'
      }
    });
    
    if (!response.ok) throw new Error('ユーザー情報の取得に失敗しました');
    const data = await response.json();
    const users = data.results.map(u => ({ id: u.id, name: u.name || 'Unknown' }));
    
    // 現在のDB設定に保存
    const activeDbId = getActiveDatabaseId();
    if (activeDbId) {
      const dbIndex = config.databases.findIndex(d => d.id.replace(/-/g, '') === activeDbId.replace(/-/g, ''));
      if (dbIndex !== -1) {
        config.databases[dbIndex].users = users; // メモリ更新
        
        // ストレージ保存
        await new Promise((resolve) => {
          chrome.storage.local.set({ notionDatabases: config.databases }, resolve);
        });
        
        // UI再描画（現在の検索条件を維持しつつ）
        const searchInput = document.getElementById('peopleSearchInput');
        // モーダルが開いている状態なので、再描画処理が必要
        // openPeopleModal内のrenderListはローカルスコープにあるため直接呼べない。
        // なので、簡易的に現在開いているtodoIdとpropNameを使って再オープンに似た挙動をするか、
        // あるいはopenPeopleModal内でrefreshUsersを定義するか…
        // ここでは一旦、モーダルを閉じずに中身を更新したいが、renderListへのアクセスがない。
        // -> openPeopleModalを再呼び出しするのが手っ取り早い。
        openPeopleModal(editingTodoId, editingPropName);
        
        // 成功メッセージ（簡易的）
        searchInput.placeholder = `更新完了: ${users.length}名`;
        setTimeout(() => searchInput.placeholder = 'ユーザーを検索...', 2000);
      }
    }
    
  } catch (error) {
    showError(`更新失敗: ${error.message}`);
  } finally {
    btn.innerHTML = originalContent;
    btn.disabled = false;
  }
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
const peopleModal = document.getElementById('peopleModal');
peopleModal.addEventListener('click', (e) => {
  if (e.target.id === 'peopleModal') closePeopleModal();
});

// People Modal イベントリスナー
document.getElementById('savePeopleBtn').addEventListener('click', savePeople);
document.getElementById('cancelPeopleBtn').addEventListener('click', closePeopleModal);
document.getElementById('refreshPeopleBtn').addEventListener('click', refreshUsers);



// Notion API用のフィルターオブジェクトを構築
function buildNotionFilter(db) {
  if (!db.filters || db.filters.length === 0) return undefined;
  
  const conditions = db.filters.map(f => {
    if (f.type === 'status') return { property: f.property, status: { equals: f.value } };
    if (f.type === 'select') return { property: f.property, select: { equals: f.value } };
    if (f.type === 'multi_select') return { property: f.property, multi_select: { contains: f.value } };
    if (f.type === 'checkbox') return { property: f.property, checkbox: { equals: f.value.toLowerCase() === 'true' } };
    if (f.type === 'people') {
      if (f.value === '__empty__') {
        return { property: f.property, people: { is_empty: true } };
      }
      return { property: f.property, people: { contains: f.value } };
    }
    return null;
  }).filter(c => c !== null);
  
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  
  if (db.filterOperator === 'or') {
    return { or: conditions };
  }
  return { and: conditions };
}

// ストレージの変更を監視して設定を自動更新
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.notionApiKey) {
      config.apiKey = changes.notionApiKey.newValue;
    }
    if (changes.notionDatabases) {
      config.databases = changes.notionDatabases.newValue;
      // 現在表示中のDBの設定が更新されたかもしれないので、スキーマキャッシュをクリアして再ロード
      // ただし、頻繁なリロードを防ぐため、明らかに影響がある場合のみにするか、
      // ここではconfigの更新にとどめ、次の操作時に反映されるようにする。
      // ユーザーリスト更新のためにはconfig.databasesの更新が必須。
    }
  }
});

// 初期化実行
init();
