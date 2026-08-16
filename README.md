# ArrowNote

ArrowNoteは、アーチェリーの練習、試合、着弾位置、振り返りを記録する個人向けPWAです。

## 現在の構成

- `index.html`: 画面、スタイル、主要ロジック
- `quote-catalog.js`: 公開用名言カタログの生成物
- `firebase-sync.js`: GoogleログインとFirestore同期
- `firestore.rules`: Firestoreのアクセス制御ルール
- `manifest.webmanifest`: PWA設定
- `sw.js`: オフラインキャッシュ
- `icons/`: ロゴとPWAアイコン
- `docs/PRODUCT_SPEC.md`: 確定仕様
- `docs/HANDOFF.md`: 端末間の作業引き継ぎ
- `docs/DECISIONS.md`: 設計判断の記録
- `AGENTS.md`: Codex向けの開発ルール

## 開発時の確認

PWAとしての動作確認には、`file://` ではなくローカルHTTPサーバーまたはHTTPS環境を使用します。公開版はGitHub Pagesを想定しています。

このアプリの記録はまずブラウザの `localStorage` に保存されます。Googleログイン後は、本保存した履歴、日誌、じっくり記録、設定、削除情報をFirestoreで端末間同期します。入力途中の下書きは端末間同期しません。

## 2台のPCで作業する場合

作業開始時：

1. GitHub Desktopで `Pull origin`
2. Codexでこのリポジトリを開く
3. `docs/HANDOFF.md` を確認する

作業終了時：

1. 仕様書と引き継ぎを更新する
2. GitHub DesktopでCommit
3. `Push origin`

同じファイルを2台で同時編集しないことを基本とします。

## セキュリティ

このリポジトリとGitHub Pagesは公開情報として扱います。FirebaseのWeb設定値は公開クライアント識別情報として `firebase-sync.js` に置き、データ保護はAuthenticationと `firestore.rules` で行います。サービスアカウント秘密鍵、Admin SDK秘密鍵、OpenAI APIキーはフロントエンドへ埋め込まず、秘密情報としてサーバー側で保持します。
