# ArrowNote

ArrowNoteは、アーチェリーの練習、試合、着弾位置、振り返りを記録する個人向けPWAです。

## 現在の構成

- `index.html`: 画面、スタイル、主要ロジック
- `quote-catalog.js`: 公開用名言カタログの生成物
- `manifest.webmanifest`: PWA設定
- `sw.js`: オフラインキャッシュ
- `icons/`: ロゴとPWAアイコン
- `docs/PRODUCT_SPEC.md`: 確定仕様
- `docs/HANDOFF.md`: 端末間の作業引き継ぎ
- `docs/DECISIONS.md`: 設計判断の記録
- `AGENTS.md`: Codex向けの開発ルール

## 開発時の確認

PWAとしての動作確認には、`file://` ではなくローカルHTTPサーバーまたはHTTPS環境を使用します。公開版はGitHub Pagesを想定しています。

このアプリの記録は現在、ブラウザの `localStorage` に保存されます。ソースコードはGitHubで同期できますが、端末内の練習履歴や下書きはPC間で自動同期されません。

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

このリポジトリとGitHub Pagesは公開情報として扱います。将来OpenAI APIを連携する場合も、APIキーをフロントエンドへ埋め込まず、Cloudflare Workersなどのサーバー側で秘密情報として保持します。

