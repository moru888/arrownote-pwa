# ArrowNote Firebase同期導入手順

最終更新：2026-08-16

## 1. 現在地

JSONバックアップ、非破壊復元、同期用ID、作成日時、更新日時に加え、GoogleログインとFirestore同期コードまで実装済み。初回ログインと所有者UIDの確認も完了した。Firebaseコンソールでの所有者UID固定ルール公開と、PCとの双方向同期試験が残っている。

この順序により、Firebase設定中に問題が起きても既存の端末内記録をJSONへ退避できる。

## 2. 予定する構成

- 画面とPWA配信：当面はGitHub Pages
- ログイン：Firebase AuthenticationのGoogleログイン
- 記録データ：Cloud Firestore
- 通常保存：まずブラウザ内へ保存し、その後オンライン時にFirestoreへ同期
- 対象：本保存したセッション、日誌、じっくり記録、設定
- 対象外：入力途中のセッション下書き、じっくり記録下書き

Firestore上の予定パス：

```text
users/{uid}/sessions/{syncId}
users/{uid}/journals/{syncId}
users/{uid}/deepJournals/{syncId}
users/{uid}/settings/main
```

## 3. Firebaseコンソールで行う操作

1. Firebaseコンソールで `ArrowNote` プロジェクトを作る。初回はGoogle Analyticsを無効にしてよい。
2. Firestore Databaseを本番モードで作成する。保存場所は東京の `asia-northeast1` を第一候補とする。場所は後から変更できないため確定前に確認する。
3. Authenticationを開始し、Googleプロバイダを有効にする。
4. プロジェクト設定の「マイアプリ」からWebアプリ `ArrowNote PWA` を登録する。Firebase Hostingの設定は当面不要。
5. 表示されたWeb用 `firebaseConfig` をアプリへ設定する。設定済みプロジェクトは `arrownote-12fff`。
6. Authenticationの承認済みドメインへGitHub Pagesのホスト名 `moru888.github.io` を追加する。

Web用 `firebaseConfig` は接続先識別情報であり、サービスアカウント秘密鍵とは異なる。ただし、Firestoreの安全性は必ず認証とセキュリティルールで確保する。

## 4. 初期セキュリティルール案

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
  }
}
```

このルールでは、ログインした本人の `users/{uid}` 配下だけを読み書きできる。テストモードの全公開ルールを使い続けない。リポジトリ内の `firestore.rules` と同じ内容である。

### 個人利用向けの最終固定

初期ルールを公開してGitHub Pages版で一度Googleログインすると、設定画面に「個人固定用UID」が表示される。そのUIDを控え、次のようにルールを固定する。ArrowNoteでは確認済みUIDをリポジトリ内の `firestore.rules` へ反映済みである。

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == 'ここを本人のUIDへ置換'
                         && userId == request.auth.uid;
    }
  }
}
```

UID固定後は、別のGoogleアカウントがArrowNoteの公開ページを開いてもFirestoreを読み書きできない。

## 5. GitHubへ置いてはいけないもの

- サービスアカウントのJSON秘密鍵
- Admin SDKの秘密鍵
- OpenAI APIキー
- メールやパスワードなどのログイン情報

FirebaseのWeb用設定値を追加する場合でも、セキュリティルールと承認済みドメインを先に整える。

## 6. 実装する同期動作

1. ユーザーがGoogleでログインする。
2. 起動時にFirestoreと端末内記録を同期用IDで比較する。
3. 同じIDでは `updatedAt` が新しい方を採用する。
4. 片方だけにある記録は他方へ追加する。
5. 本保存、日誌保存、後日編集、削除、設定変更の直後に同期を予約する。
6. オフライン時は端末内保存を成功扱いとし、オンライン復帰後に再同期する。
7. 同期状態を「端末に保存済み」「同期中」「同期済み」「要再試行」で表示する。

削除は単純な消去ではなく、削除日時を持つ論理削除を使う。これにより別端末から古い記録が復活することを防ぐ。

## 7. GitHub Pages利用時のログイン注意

外部ホスティング上のリダイレクト式ログインは、ブラウザの第三者ストレージ制限の影響を受ける場合がある。初期実装ではポップアップ式ログインを中心に実機確認し、問題が続く場合はFirebase Hostingまたは独自ドメインへの移行を検討する。

## 8. 接続後の確認項目

- iPhoneで保存したセッションがPCに現れる。
- PCで追記した振り返りがiPhoneに現れる。
- オフライン中に保存でき、再接続後に同期される。
- 同じ記録を両端末で編集した場合、更新日時が新しい内容になる。
- 他のGoogleアカウントからデータを読めない。
- ログアウト後も端末内記録をどう扱うか確認画面が出る。
