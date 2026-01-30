# Notion TODO Manager

NotionのTODOデータベースをChrome拡張機能のサイドパネルで管理できる拡張機能です。

![Extension Icon](icons/icon128.png)

## 機能

- ✅ **TODOリストの表示**: Notionデータベースのタスクをサイドパネルにリアルタイム表示
- ✅ **タスク完了切り替え**: クリック一つでタスクの完了/未完了を切り替え
- ✅ **完了タスク自動削除**: 完了したタスクはアニメーション付きでリストから消える
- ✅ **新規タスク追加**: サイドパネルから直接新しいタスクを追加
- ✅ **期限表示**: 期限プロパティを表示（期限切れは赤色で強調）
- ✅ **タグ表示**: タグ/ラベルプロパティをバッジで表示
- ✅ **設定ボタン**: ヘッダーから簡単に設定ページにアクセス
- 🔄 **リフレッシュ機能**: 最新のタスク情報を即座に取得
- 🎨 **モダンなUI**: グラデーションとアニメーションを使用した美しいデザイン
- 🔒 **セキュア**: APIキーは暗号化されたChromeストレージに安全に保存

## インストール方法

### 1. 拡張機能をChromeに読み込む

1. Chromeのアドレスバーに `chrome://extensions/` と入力
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このフォルダ（`notion-todo-extension`）を選択

### 2. Notion Integrationを作成

1. [Notion Integrations](https://www.notion.so/my-integrations) にアクセス
2. 「New integration」をクリック
3. 以下を入力:
   - Name: 任意の名前（例: TODO Manager）
   - Associated workspace: 使用するワークスペースを選択
   - Type: Internal
4. 「Submit」をクリック
5. **Internal Integration Token**（APIキー）をコピーして保存

### 3. NotionデータベースにIntegrationを接続

1. NotionでTODOを管理したいデータベースを開く
2. データベースの右上「...」メニューをクリック
3. 「コネクトを追加」→ 先ほど作成したIntegrationを選択
4. データベースのURLから**データベースID**を取得
   - URL例: `https://www.notion.so/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...`
   - `?v=`の前の32文字の英数字がデータベースID

### 4. Googleカレンダー連携の設定 (Google Apps Script)

この拡張機能は、Google Apps Script (GAS) を経由してGoogleカレンダー/Tasksにタスクを追加します。

1. [Google Apps Script](https://script.google.com/home) にアクセスし、「新しいプロジェクト」を作成
2. 以下のコードをエディタに貼り付け:

   ```javascript
   function doPost(e) {
     const data = JSON.parse(e.postData.contents);
     const title = data.title;

     // Google Tasksに追加 (デフォルトのリスト)
     // Tasks APIが有効になっている必要があります
     // カレンダーに追加したい場合は CalendarApp.createEvent(...) を使用してください
     try {
       const taskListId = "@default";
       Tasks.Tasks.insert(
         {
           title: title,
           due: new Date().toISOString(),
         },
         taskListId,
       );

       return ContentService.createTextOutput(
         JSON.stringify({ status: "success" }),
       ).setMimeType(ContentService.MimeType.JSON);
     } catch (err) {
       return ContentService.createTextOutput(
         JSON.stringify({ status: "error", message: err.toString() }),
       ).setMimeType(ContentService.MimeType.JSON);
     }
   }
   ```

3. 左側のメニューから「サービス」の横の「+」をクリックし、**Google Tasks API** を追加
4. 右上の「デプロイ」→「新しいデプロイ」をクリック
5. 歯車アイコンから「ウェブアプリ」を選択
   - 説明: 任意
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員** (これを選択しないと拡張機能からアクセスできません)
6. 「デプロイ」をクリックし、発行された **ウェブアプリURL** をコピー

### 5. 拡張機能を設定

1. Chrome拡張機能一覧で「Notion TODO Manager」の「拡張機能のオプション」をクリック
2. 以下を入力:
   - **Notion APIキー**: 手順2でコピーしたInternal Integration Token
   - **データベースID**: 手順3で取得したデータベースID
   - **GAS WebアプリURL**: 手順4で取得したウェブアプリURL
3. 「保存」をクリック

## 使い方

### サイドパネルを開く

- Chrome拡張機能アイコンをクリック
- サイドパネルが開き、TODOリストが表示されます

### タスクの操作

- **完了切り替え**: タスクをクリックして完了/未完了を切り替え
  - 完了したタスクはチェックマーク表示後、スムーズにリストから消える（約1秒）
  - Notionでは完了済みとして保存されます
- **新規追加**: 上部の入力欄にタスク名を入力して「追加」
- **リフレッシュ**: 右上のリフレッシュアイコンをクリックして最新情報を取得
- **設定**: 左上の⚙️アイコンから設定ページを開く

## データベース要件

Notionデータベースには以下のプロパティが必要です:

### 必須プロパティ

| プロパティ名      | タイプ   | 説明             |
| ----------------- | -------- | ---------------- |
| Name または Title | Title    | タスクのタイトル |
| Done または 完了  | Checkbox | タスクの完了状態 |

### オプションプロパティ

| プロパティ名     | タイプ                | 説明                                 |
| ---------------- | --------------------- | ------------------------------------ |
| Due または 期限  | Date                  | タスクの期限（期限切れは赤色で表示） |
| Tags または タグ | Multi-select / Select | タスクのタグ・ラベル                 |

> **💡 ヒント**: プロパティ名は日本語でも英語でも対応しています。期限とタグは設定すると自動的に表示されます。

## 技術スタック

- **Manifest V3**: 最新のChrome拡張機能API
- **Side Panel API**: Chrome拡張機能のサイドパネル機能
- **Notion REST API**: Notionデータベースとの連携
- **Chrome Storage API**: セキュアな設定保存

## トラブルシューティング

### TODOが表示されない

1. 設定ページでAPIキーとデータベースIDが正しいか確認
2. NotionデータベースにIntegrationが接続されているか確認
3. データベースに必要なプロパティ（Name、Done）があるか確認

### エラーメッセージが表示される

- **"TODOの取得に失敗しました"**: APIキーまたはデータベースIDが間違っている可能性
- **"チェックボックスプロパティが見つかりません"**: データベースにCheckboxタイプのプロパティを追加してください

## ライセンス

MIT License

## 作成者

Created with ❤️ using Google Antigravity
