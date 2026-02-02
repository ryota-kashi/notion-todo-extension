# Notion TODO Manager

NotionのTODOデータベースをChrome拡張機能のサイドパネルで管理できる拡張機能です。

![Extension Icon](src/icons/icon128.png)

## 機能

- ✅ **TODOリストの表示**: Notionデータベースのタスクをサイドパネルにリアルタイム表示
- ✅ **タスク完了切り替え**: クリック一つでタスクの完了/未完了を切り替え（完了タスクは自動で消えます）
- ✅ **複数データベース対応**: 仕事用、個人用など複数のデータベースを登録して切り替え可能
- ✅ **多様なプロパティ表示**:
  - 期限 (Date)
  - ステータス (Status)
  - タグ (Multi-select / Select)
  - 担当者 (People)
  - ロールアップ (Rollup)
  - 関数 (Formula)
  - URL, ファイル, チェックボックス等
- 🔄 **リフレッシュ機能**: 最新のタスク情報を即座に取得
- 🎨 **モダンなUI**: グラデーションとアニメーションを使用した美しいデザイン
- 🔒 **セキュア**: APIキーは暗号化されたChromeストレージに安全に保存

## インストール方法

### 1. 拡張機能をChromeに読み込む

1. Chromeのアドレスバーに `chrome://extensions/` と入力
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このプロジェクト内の **`src` フォルダ** を選択して読み込む

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

> **注意**: ロールアッププロパティを使用する場合、そのロールアップが参照している**「相手のデータベース」**にも、同様にコネクトを追加してください。そうしないと値が取得できません。

### 4. 拡張機能を設定

1. Chrome拡張機能一覧で「Notion TODO Manager」をクリックし、ヘッダーの⚙️アイコンから設定画面を開く
2. **APIキー**を入力して保存
3. **データベース**を追加（名前とIDを入力）
4. 必要に応じて、表示したいプロパティを選択
   - ※Notion側でプロパティを追加した場合は、編集画面の「🔄 プロパティ情報を更新」ボタンを押してください

## データベース要件

以下のいずれかのプロパティでタスクの完了状態を管理できます:

1. **Status (ステータス)** プロパティ
   - "Complete", "Done", "完了" などの名前のステータスを完了として扱います
2. **Checkbox (チェックボックス)** プロパティ
   - チェックありを完了として扱います

※両方ある場合はStatusプロパティが優先されます。

## トラブルシューティング

### ロールアップやリレーションが表示されない

1. **権限確認**: ロールアップの参照先データベースにもNotionインテグレーションが追加されているか確認してください。
2. **情報の更新**: オプション画面でデータベースの編集を開き、「🔄 プロパティ情報を更新」ボタンを押してください。

### TODOが表示されない

1. 設定ページでAPIキーとデータベースIDが正しいか確認
2. NotionデータベースにIntegrationが接続されているか確認

## 技術スタック

- **Manifest V3**
- **Side Panel API**
- **Notion REST API**
- **Vanilla JS / CSS** (No build required)

## ライセンス

MIT License

## 作成者

Created with ❤️ using Google Antigravity
