# つたえる

このアプリが、言葉を失ったご本人の「伝えたい」という気持ちを支え、生きる希望につながりますように。そして、そばで支えるご家族の心が、少しでも軽くなりますように。

大切なパートナーやご家族と過ごす日々が、素晴らしい毎日でありますように。そのお役に立てれば幸いです。

May this app help those who have lost their speech hold on to hope, and live each day in their own way. May it also lighten, even a little, the hearts of the families who stand beside them.

May your days with your beloved partner and family be wonderful ones. I would be honored if this small tool can help, even in a small way.

自分で選んだ言葉を、ボタンひとつで声と文字にして相手に伝えるためのアプリです。
スマートフォンのブラウザで動き、ホーム画面に追加するとアプリのように使えます。一度開いたあとは、インターネットにつながっていなくても動きます。

## ページの場所

- 紹介ページ（日本語／English、デモ動画あり）：https://nerorisaia.github.io/tsutaeru-app/
  - 英語で直接開く場合：https://nerorisaia.github.io/tsutaeru-app/?lang=en
- アプリ本体：https://nerorisaia.github.io/tsutaeru-app/app/

## 入れ方

1. スマートフォンのブラウザで紹介ページを開き、「アプリを開く」ボタンを押します（アプリ本体のページ https://nerorisaia.github.io/tsutaeru-app/app/ を直接開いても同じです）。
2. **アプリ本体のページを開いた状態で**、ブラウザのメニューから「ホーム画面に追加」を選びます。
   - Android（Chrome）：右上の「︙」→「ホーム画面に追加」または「アプリをインストール」
   - iPhone（Safari）：下の共有ボタン →「ホーム画面に追加」
3. ホーム画面にできた「つたえる」のアイコンから起動します。

紹介ページでは「ホーム画面に追加」をしないでください（紹介ページのショートカットになってしまいます）。

## フォルダ構成

- `index.html` … 紹介ページ
- `app/` … アプリ本体（`index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest`, `icons/`）
- `media/` … デモ動画
- `sw.js`（ルート）… 以前ルートで動いていた旧版の Service Worker を解除するための移行用ファイル

## 注意事項

- このアプリは**試作品**です。動作は保証できません。
- このアプリは**ナースコールの代わりにはなりません**。「看護師さんを呼んで」ボタンは言葉を声と文字で表示するだけで、誰かに通知が届くことはありません。病院・施設のナースコールは、必ず別に手の届く場所に置いてください。
- 入力したり追加したりした言葉は、**その端末の中だけに保存**されます。外部へ送信されることはありません。
- 端末に日本語の読み上げ音声が入っていない場合、声が出ないことがあります（文字は表示されます）。
