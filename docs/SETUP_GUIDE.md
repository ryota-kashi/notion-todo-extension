# Notion TODO Manager セットアップガイド

このガイドでは、Notion TODO Managerの詳細なセットアップ手順を説明します。

## 📋 前提条件

- Google Chrome ブラウザ
- Notionアカウント
- TODOを管理したいNotionデータベース

## 🔧 セットアップ手順

### ステップ1: Chrome拡張機能をインストール

1. Chromeで `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `notion-todo-extension` フォルダを選択

✅ 拡張機能がインストールされました!

---

### ステップ2: Notion Integrationを作成

1. [Notion Integrations](https://www.notion.so/my-integrations) にアクセス
2. 「+ New integration」ボタンをクリック
3. 以下の情報を入力:
   - **Name**: `TODO Manager`（または任意の名前）
   - **Associated workspace**: 使用するワークスペースを選択
   - **Type**: `Internal` を選択
4. 「Submit」をクリック
5. 表示された **Internal Integration Token** をコピー
   - 形式: `secret_xxxxxxxxxxxxxxxxxxxxxxxxxx`
   - ⚠️ このトークンは安全に保管してください

---

### ステップ3: Notionデータベースのプロパティをセットアップ

TODOデータベースには以下のプロパティが必要です:

| プロパティ名         | タイプ   | 説明                     |
| -------------------- | -------- | ------------------------ |
| Name（または Title） | Title    | タスクのタイトル（必須） |
| Done（または 完了）  | Checkbox | タスクの完了状態（必須） |

**プロパティの追加方法:**

1. Notionでデータベースを開く
2. 右上の「+」アイコンをクリック
3. プロパティタイプを選択:
   - タイトルプロパティ（自動的に存在）
   - Checkboxプロパティを追加し、名前を「Done」または「完了」に設定

---

### ステップ4: データベースにIntegrationを接続

1. Notionでデータベースを開く
2. データベースの右上「⋯」（3点メニュー）をクリック
3. 「コネクトを追加」（または「Add connections」）を選択
4. ステップ2で作成したIntegration（例: TODO Manager）を選択
5. 「確認」をクリック

✅ Integrationがデータベースにアクセスできるようになりました!

---

### ステップ5: データベースIDを取得

データベースIDは、NotionのデータベースURLから取得できます。

**URL例:**

```
https://www.notion.so/workspace-name/1234567890abcdef1234567890abcdef?v=...
                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                          これがデータベースID
```

**取得手順:**

1. Notionでデータベースを開く
2. ブラウザのアドレスバーからURLをコピー
3. `?v=` の**前の部分**（32文字の英数字）がデータベースID
4. 例: `1234567890abcdef1234567890abcdef`

**注意:**

- ハイフンが含まれている場合（例: `12345678-90ab-cdef-1234-567890abcdef`）もそのままコピーしてOK
- 拡張機能が自動的に処理します

---

### ステップ6: 拡張機能を設定

1. Chrome拡張機能一覧で「Notion TODO Manager」を探す
2. 「拡張機能のオプション」をクリック
3. 以下を入力:
   - **Notion APIキー**: ステップ2でコピーしたInternal Integration Token
   - **データベースID**: ステップ5で取得したデータベースID
4. 「保存」をクリック

✅ 設定完了!

---

## 🎉 使用開始

1. Chrome拡張機能アイコンをクリック
2. サイドパネルが開き、TODOリストが表示されます
3. タスクをクリックして完了/未完了を切り替え
4. 新しいタスクを追加するには、上部の入力欄に入力して「追加」ボタンをクリック

---

## ❓ トラブルシューティング

### エラー: "Invalid request URL"

**原因:** データベースIDの形式が正しくない

**解決方法:**

1. 設定ページでデータベースIDを再確認
2. NotionのデータベースURLから正しいIDをコピー
3. `?v=`の前の32文字の英数字のみをコピー
4. ハイフンの有無は気にしなくてOK（自動処理されます）

### エラー: "object not found"

**原因:** Integrationがデータベースにアクセスできない

**解決方法:**

1. Notionでデータベースを開く
2. 「⋯」メニュー →「コネクト」を確認
3. 作成したIntegrationが接続されているか確認
4. 接続されていない場合は、ステップ4を再実行

### エラー: "Unauthorized"

**原因:** APIキーが無効または間違っている

**解決方法:**

1. [Notion Integrations](https://www.notion.so/my-integrations) で正しいAPIキーを確認
2. 設定ページで再度APIキーを入力
3. `secret_`で始まる正しい形式か確認

### TODOが表示されない

**チェックリスト:**

- [ ] データベースに必要なプロパティ（Name、Done）がある
- [ ] Integrationがデータベースに接続されている
- [ ] APIキーとデータベースIDが正しい
- [ ] データベースに少なくとも1つのアイテムがある

### デバッグ方法

1. サイドパネル上で右クリック → 「検証」
2. Consoleタブを開く
3. 表示されるエラーメッセージを確認
4. `Database ID:` と `API URL:` の情報を確認

---

## 📝 よくある質問

### Q: 複数のデータベースを管理できますか?

A: 現在のバージョンでは1つのデータベースのみです。将来のバージョンで対応予定です。

### Q: タスクの編集や削除はできますか?

A: 現在のバージョンでは、完了切り替えと新規追加のみ対応しています。編集・削除はNotion本体で行ってください。

### Q: プロパティ名は英語でないとダメですか?

A: いいえ、日本語でもOKです。「Name」「タイトル」「Title」、「Done」「完了」「Status」に対応しています。

### Q: APIキーは安全ですか?

A: はい、APIキーはChromeの暗号化されたストレージに保存され、外部に送信されることはありません。

---

## 🔗 便利なリンク

- [Notion API Documentation](https://developers.notion.com/)
- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [Notion Integrations](https://www.notion.so/my-integrations)

---

## 💡 次のステップ

セットアップが完了したら:

1. ✅ サイドパネルでTODOを確認
2. ✅ タスクを追加してみる
3. ✅ タスクの完了切り替えを試す
4. ✅ リフレッシュボタンで最新情報を取得

快適なタスク管理をお楽しみください! 🎉
