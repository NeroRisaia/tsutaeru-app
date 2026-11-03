/* つたえる — 本人が自分で選んだ言葉を、少ない動作ですぐ声と文字で伝えるための道具
 * 大原則：本人が選んだ言葉だけが、本人の言葉。AIによる推測・代弁・候補生成は入れない。
 * 完全オフライン・外部通信なし・データは localStorage のみ。
 */
(function () {
  'use strict';

  var VERSION = '1.0.2';
  var KEY = 'tsutaeru.data.v1';
  var PAGE_SIZE = 6;          // 1画面の選択肢は最大6行
  var FAV_MAX = 6;            // よく使う：最大6件
  var GUIDE_TIMEOUT = 30000;  // 場所への誘導を自動で閉じるまで
  var LONG_PRESS_MS = 3000;   // 家族用設定：3秒長押し

  // ---------- 初期フレーズ（仕様どおり） ----------
  function defaultCats() {
    function p(list, flags) {
      return list.map(function (t) {
        var o = { id: uid(), text: t };
        if (flags && flags[t]) { for (var k in flags[t]) o[k] = flags[t][k]; }
        return o;
      });
    }
    return [
      { id: 'body', name: '体のこと', builtin: true, phrases: p(
        ['痛い', '苦しい', '暑い', '寒い', 'かゆい', '気持ち悪い', '姿勢を変えたい', 'トイレに行きたい', '眠い', '看護師さんを呼んで'],
        { '痛い': { place: true }, '苦しい': { place: true }, '寒い': { place: true }, 'かゆい': { place: true },
          '気持ち悪い': { place: true }, '看護師さんを呼んで': { alert: true } }) },
      { id: 'place', name: '体の場所', builtin: true, phrases: p(
        ['頭', '首', '肩', '腕', '手', '胸', 'お腹', '背中', '腰', '足']) },
      { id: 'food', name: '飲み食い', builtin: true, phrases: p(
        ['水がほしい', 'お茶がほしい', 'ごはんがほしい', 'もういらない']) },
      { id: 'people', name: '人・連絡', builtin: true, phrases: p(
        ['家族に連絡してほしい', '会いたい人がいる', '面会はまだかな']) },
      { id: 'talk', name: '気持ちと会話', builtin: true, phrases: p(
        ['ありがとう', '大丈夫', 'うれしい', 'さみしい', '不安', 'テレビをつけて', 'テレビを消して', '電気をつけて',
         '電気を消して', '窓を開けて', '窓を閉めて', 'もう少しここにいて', '10分後にまた来てほしい', '今日はいい天気だね',
         'リハビリ頑張るよ', 'みんな元気？', 'ミニ四駆の話がしたい', '釣りの話がしたい', '外の空気を吸いたい',
         '写真を見せて', '音楽をかけて']) }
    ];
  }

  var uidSeq = 0;
  function uid() { uidSeq++; return 'p' + Date.now().toString(36) + uidSeq.toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

  // ---------- 保存（localStorage のみ・失敗しても止まらない） ----------
  var data;
  function freshData() {
    return { v: 1, cats: defaultCats(), counts: {}, settings: { font: 'xl', rate: 0.95 } };
  }
  function load() {
    var d = null;
    try { var raw = localStorage.getItem(KEY); if (raw) d = JSON.parse(raw); } catch (e) { d = null; }
    if (!d || !Array.isArray(d.cats) || !d.cats.length) d = freshData();
    if (!d.counts || typeof d.counts !== 'object') d.counts = {};
    if (!d.settings || typeof d.settings !== 'object') d.settings = {};
    if (d.settings.font !== 'l' && d.settings.font !== 'xl') d.settings.font = 'xl';
    if (typeof d.settings.rate !== 'number' || !(d.settings.rate > 0)) d.settings.rate = 0.95;
    d.cats = d.cats.filter(function (c) { return c && typeof c.name === 'string'; });
    d.cats.forEach(function (c) {
      if (!c.id) c.id = uid();
      if (!Array.isArray(c.phrases)) c.phrases = [];
      c.phrases = c.phrases.filter(function (x) { return x && typeof x.text === 'string' && x.text.trim(); });
      c.phrases.forEach(function (x) { if (!x.id) x.id = uid(); });
    });
    return d;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 容量不足などでも動作は続ける */ }
  }

  // ---------- 状態 ----------
  var ui = {
    tab: 'body',
    page: 0,
    favList: [],      // よく使う：タブを開いた時点で固定（押している最中に並びが動かないように）
    pending: null,    // 「痛い」など、場所とつなぐ状態の言葉
    kanaRow: 0,
    composed: '',
    lastText: ''
  };
  var guideTimer = null;

  // ---------- 便利関数 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getCat(id) { for (var i = 0; i < data.cats.length; i++) if (data.cats[i].id === id) return data.cats[i]; return null; }
  function findPhraseByText(text) {
    for (var i = 0; i < data.cats.length; i++) {
      var ps = data.cats[i].phrases;
      for (var j = 0; j < ps.length; j++) if (ps[j].text === text) return { cat: data.cats[i], phrase: ps[j] };
    }
    return null;
  }
  function safe(fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { try { console.warn('[つたえる]', e); } catch (_) {} }
    };
  }

  // ---------- 読み上げ（失敗しても固まらない・連打しても壊れない） ----------
  var speakSeq = 0;
  var voiceCache = null;
  function jaVoices() {
    try {
      var vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      return (vs || []).filter(function (v) { return /^ja([-_]|$)/i.test(v.lang || ''); });
    } catch (e) { return []; }
  }
  function pickVoice() {
    if (voiceCache) return voiceCache;
    var ja = jaVoices();
    if (!ja.length) return null;
    // オフラインでも使える端末内の音声を優先
    var local = ja.filter(function (v) { return v.localService; });
    voiceCache = (local[0] || ja[0]);
    return voiceCache;
  }
  function speak(text) {
    text = String(text || '').trim();
    if (!text) return;
    ui.lastText = text;
    setDisplay(text);
    var ss = window.speechSynthesis;
    if (!ss || typeof window.SpeechSynthesisUtterance === 'undefined') return;
    var my = ++speakSeq;
    var delay = 0;
    try { if (ss.speaking || ss.pending) { ss.cancel(); delay = 40; } } catch (e) {}
    var go = function () {
      if (my !== speakSeq) return; // もっと新しい言葉が押された
      try {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'ja-JP';
        var v = pickVoice();
        if (v) u.voice = v;
        u.rate = data.settings.rate || 0.95;
        u.pitch = 1;
        u.volume = 1;
        u.onerror = function () {};
        ss.speak(u);
        if (ss.paused) ss.resume();
      } catch (e) {}
    };
    if (delay) setTimeout(go, delay); else go();
  }

  // ---------- 上部の大きな表示 ----------
  function setDisplay(text) {
    var d = $('display'), s = $('displayText');
    d.classList.remove('idle');
    s.textContent = text;
    // 枠に収まるまで文字を小さくする
    var size = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--fsDisplay'), 10) || 40;
    s.style.fontSize = size + 'px';
    var guard = 0;
    while (guard++ < 14 && size > 16 && (s.offsetHeight > d.clientHeight - 4 || s.scrollWidth > d.clientWidth - 8)) {
      size -= 2;
      s.style.fontSize = size + 'px';
    }
    d.classList.remove('flash');
    void d.offsetWidth;
    d.classList.add('flash');
  }

  // ---------- 使用回数 ----------
  function countUp(text) {
    var c = data.counts[text];
    if (!c || typeof c !== 'object') c = { n: 0, t: 0 };
    c.n = (c.n || 0) + 1;
    c.t = Date.now();
    data.counts[text] = c;
    save();
  }
  function topFavs() {
    return Object.keys(data.counts)
      .map(function (k) { return [k, data.counts[k]]; })
      .filter(function (e) { return e[1] && e[1].n > 0; })
      .sort(function (a, b) { return (b[1].n - a[1].n) || ((b[1].t || 0) - (a[1].t || 0)); })
      .slice(0, FAV_MAX)
      .map(function (e) { return e[0]; });
  }

  // ---------- 場所への誘導 ----------
  function showGuide(stateText) {
    ui.pending = stateText;
    $('guideSub').textContent = '「' + stateText + '」の場所をえらぶ ▶';
    $('guide').hidden = false;
    clearTimeout(guideTimer);
    guideTimer = setTimeout(safe(function () { hideGuide(true); }), GUIDE_TIMEOUT);
  }
  function hideGuide(clearPending) {
    clearTimeout(guideTimer);
    $('guide').hidden = true;
    if (clearPending && ui.tab !== 'place') ui.pending = null;
  }
  function clearPending() {
    ui.pending = null;
    hideGuide(true);
  }

  // ---------- タブ ----------
  function tabList() {
    var t = [{ id: 'fav', name: 'よく使う' }];
    data.cats.forEach(function (c) { t.push({ id: c.id, name: c.name }); });
    t.push({ id: 'kana', name: '50音表' });
    return t;
  }
  function renderTabs() {
    var h = '';
    tabList().forEach(function (t) {
      h += '<button type="button" class="tab" role="tab" data-act="tab" data-tab="' + esc(t.id) + '" aria-selected="' +
        (t.id === ui.tab ? 'true' : 'false') + '">' + esc(t.name) + '</button>';
    });
    h += '<button type="button" class="tab family" id="familyBtn" aria-label="家族用設定。3秒長押しで開きます">' +
      '<span class="prog"></span><span id="familyLbl">家族用<br>3秒長押し</span></button>';
    var tabsEl = $('tabs');
    var cells = tabList().length + 1;
    var cols = Math.max(4, Math.min(5, Math.ceil(cells / 2)));   // カテゴリを足してもできるだけ2段に収める
    tabsEl.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    tabsEl.classList.toggle('dense', cols > 4);
    tabsEl.innerHTML = h;
    bindFamily();
  }
  function selectTab(id) {
    if (id !== 'fav' && id !== 'kana' && !getCat(id)) id = data.cats[0] ? data.cats[0].id : 'kana';
    ui.tab = id;
    ui.page = 0;
    if (id === 'fav') ui.favList = topFavs();
    if (id !== 'place') { ui.pending = null; }
    hideGuide(false);
    var tabs = document.querySelectorAll('#tabs .tab[data-tab]');
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-selected', tabs[i].getAttribute('data-tab') === id ? 'true' : 'false');
    renderMain();
    $('main').scrollTop = 0;
  }

  // ---------- 中央 ----------
  function phraseBtn(text, opts) {
    opts = opts || {};
    var cls = 'phrase' + (opts.alert ? ' alert' : '') + (opts.cls ? ' ' + opts.cls : '');
    return '<button type="button" class="' + cls + '" data-act="' + (opts.act || 'say') + '" data-text="' + esc(text) + '"' +
      (opts.place ? ' data-place="1"' : '') + '><span class="pt">' + esc(text) + '</span>' +
      (opts.sub ? '<span class="sub">' + esc(opts.sub) + '</span>' : '') + '</button>';
  }
  // 1ページの件数：最大6行。画面の高さに「ページ送り」まで必ず収まる件数にする（端末ごとに一定＝位置は動かない）
  function modeBarH() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--modeH')) || 64;
  }
  function perPage(total, cols, reserved) {
    cols = cols || 1;
    try {
      var m = $('main'), cs = getComputedStyle(m), root = getComputedStyle(document.documentElement);
      var gap = parseFloat(root.getPropertyValue('--gap')) || 6;
      var rowH = (parseFloat(root.getPropertyValue('--btnH')) || 76) + gap;
      var avail = m.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) + gap - (reserved ? reserved + gap : 0);
      if (!(avail > 0)) return PAGE_SIZE * cols;
      var noPager = Math.min(PAGE_SIZE, Math.floor(avail / rowH)) * cols;
      if (total <= noPager) return Math.max(total, 1);
      return Math.max(2, Math.min(PAGE_SIZE, Math.floor((avail - (72 + gap)) / rowH))) * cols;
    } catch (e) { return PAGE_SIZE * cols; }
  }
  function pager(total, per) {
    var pages = Math.ceil(total / (per || PAGE_SIZE));
    if (pages <= 1) return '';
    return '<div class="pager"><button type="button" data-act="prev"' + (ui.page <= 0 ? ' disabled' : '') + '>◀ 前へ</button>' +
      '<span class="pageNo">' + (ui.page + 1) + ' / ' + pages + '</span>' +
      '<button type="button" data-act="next"' + (ui.page >= pages - 1 ? ' disabled' : '') + '>次へ ▶</button></div>';
  }
  function renderMain() {
    var m = $('main');
    if (ui.tab === 'kana') { renderKana(); return; }
    var h = '';
    if (ui.tab === 'fav') {
      var list = ui.favList;
      if (!list.length) {
        h = '<div class="empty">よく使う言葉が、ここに自動で並びます。<br>（押した回数の多い言葉 6つまで）</div>';
      } else {
        list.forEach(function (t) {
          var f = findPhraseByText(t);
          var isPlace = f && f.cat.id === 'place';
          h += phraseBtn(t, {
            place: f && f.phrase.place,
            alert: f && f.phrase.alert,
            act: isPlace ? 'place' : 'say'
          });
        });
      }
      m.innerHTML = h;
      return;
    }
    var cat = getCat(ui.tab);
    if (!cat) { m.innerHTML = '<div class="empty">カテゴリがありません。</div>'; return; }
    var ps = cat.phrases;
    // 体の場所は短い語なので2列（6行以内＝12個まで1画面）。それ以外は全幅1列。
    // 体の場所：2列で全部入らない小さい画面では3列にして、できるだけ1画面に収める
    var placeCols = 2;
    if (cat.id === 'place' && perPage(ps.length, 2, modeBarH()) < ps.length) placeCols = 3;
    var per = cat.id === 'place' ? perPage(ps.length, placeCols, modeBarH()) : perPage(ps.length, 1, 0);
    var pages = Math.max(1, Math.ceil(ps.length / per));
    if (ui.page > pages - 1) ui.page = pages - 1;
    var slice = ps.slice(ui.page * per, ui.page * per + per);
    if (cat.id === 'place') {
      // つなぎ状態の表示枠は常に確保（ボタンの位置が動かないように）
      if (ui.pending) {
        h += '<div class="modeBar on"><span class="modeText">「' + esc(ui.pending) + '」とつないで読みます</span>' +
          '<button type="button" data-act="unlink">つながない</button></div>';
      } else {
        h += '<div class="modeBar"><span class="modeText">場所だけを読みます</span></div>';
      }
      h += '<div class="placeGrid' + (placeCols === 3 ? ' c3' : '') + '">';
      slice.forEach(function (x) {
        h += phraseBtn(x.text, { act: 'place', cls: 'place' + (ui.pending ? ' combo' : ''), sub: ui.pending ? x.text + 'が' + ui.pending : '' });
      });
      h += '</div>';
      h += pager(ps.length, per);
      m.innerHTML = h;
      return;
    } else {
      if (!ps.length) h += '<div class="empty">まだ言葉がありません。<br>家族用設定から追加できます。</div>';
      slice.forEach(function (x) { h += phraseBtn(x.text, { place: x.place, alert: x.alert }); });
    }
    h += pager(ps.length, per);
    m.innerHTML = h;
  }

  // ---------- 50音表 ----------
  var KANA_ROWS = [
    ['あ', 'あいうえお'], ['か', 'かきくけこ'], ['さ', 'さしすせそ'], ['た', 'たちつてと'], ['な', 'なにぬねの'],
    ['は', 'はひふへほ'], ['ま', 'まみむめも'], ['や', 'やゆよ'], ['ら', 'らりるれろ'], ['わ', 'わをん']
  ];
  function pairMap(s) {
    var m = {};
    for (var i = 0; i + 1 < s.length; i += 2) { m[s[i]] = s[i + 1]; m[s[i + 1]] = s[i]; }
    return m;
  }
  var DAKU = pairMap('かがきぎくぐけげこごさざしじすずせぜそぞただちぢつづてでとどはばひびふぶへべほぼうゔ');
  var HANDAKU = pairMap('はぱひぴふぷへぺほぽ');
  var SMALL = pairMap('あぁいぃうぅえぇおぉやゃゆゅよょつっわゎ');
  var BA_TO_HA = { 'ば': 'は', 'び': 'ひ', 'ぶ': 'ふ', 'べ': 'へ', 'ぼ': 'ほ' };
  var PA_TO_BA = { 'ぱ': 'ば', 'ぴ': 'び', 'ぷ': 'ぶ', 'ぺ': 'べ', 'ぽ': 'ぼ' };

  function renderKana() {
    // 5行構成（小さい画面でも1画面に収まる）：組み立て欄＋全部消す＋読む／行×2／文字／゛゜小ー＋1字消す
    var h = '<div class="kanaTop">' +
      '<div class="composer" id="composer"></div>' +
      '<button type="button" class="kana ctl" data-act="kclear">全部<br>消す</button>' +
      '<button type="button" class="kana read" data-act="kread">▶読む</button></div>';
    h += '<div class="kanaGrid c5" id="kanaRows">';
    KANA_ROWS.forEach(function (r, i) {
      h += '<button type="button" class="kana row' + (i === ui.kanaRow ? ' on' : '') + '" data-act="krow" data-row="' + i +
        '" aria-pressed="' + (i === ui.kanaRow) + '">' + r[0] + '<span class="gyo">行</span></button>';
    });
    h += '</div><div class="kanaGrid c5" id="kanaChars"></div>';
    h += '<div class="kanaGrid c5">' +
      '<button type="button" class="kana mod" data-act="kmod" data-mod="daku">゛<span class="modSub">にごる</span></button>' +
      '<button type="button" class="kana mod" data-act="kmod" data-mod="handaku">゜<span class="modSub">まる</span></button>' +
      '<button type="button" class="kana mod" data-act="kmod" data-mod="small">小<span class="modSub">ゃゅょっ</span></button>' +
      '<button type="button" class="kana mod" data-act="kadd" data-ch="ー">ー<span class="modSub">のばす</span></button>' +
      '<button type="button" class="kana ctl back" data-act="kback">1字<br>消す</button></div>';
    $('main').innerHTML = h;
    renderKanaChars();
    renderComposer();
  }
  function renderKanaChars() {
    var row = KANA_ROWS[ui.kanaRow][1], h = '';
    for (var i = 0; i < 5; i++) {
      if (i < row.length) h += '<button type="button" class="kana" data-act="kadd" data-ch="' + row[i] + '">' + row[i] + '</button>';
      else h += '<span></span>';
    }
    var el = $('kanaChars');
    if (el) el.innerHTML = h;
  }
  function renderComposer() {
    var c = $('composer');
    if (!c) return;
    if (ui.composed) {
      var n = Array.from(ui.composed).length;
      c.className = 'composer';
      c.style.fontSize = (n <= 6 ? 32 : n <= 9 ? 25 : n <= 14 ? 20 : 16) + 'px';
      c.innerHTML = esc(ui.composed) + '<span class="caret"></span>';
    } else { c.className = 'composer emptyC'; c.style.fontSize = ''; c.textContent = 'ここに文字が入ります'; }
  }
  function kanaMod(mod) {
    var s = ui.composed;
    if (!s) return;
    var last = s.slice(-1), rep = null;
    if (mod === 'daku') rep = DAKU[last] || (PA_TO_BA[last] || null);
    else if (mod === 'handaku') rep = HANDAKU[last] || (BA_TO_HA[last] ? HANDAKU[BA_TO_HA[last]] : null);
    else if (mod === 'small') rep = SMALL[last] || null;
    if (rep) { ui.composed = s.slice(0, -1) + rep; renderComposer(); }
  }

  // ---------- 操作 ----------
  function onSayPhrase(btn) {
    var text = btn.getAttribute('data-text');
    speak(text);
    countUp(text);
    if (btn.getAttribute('data-place') === '1') showGuide(text);
    else clearPending();
  }
  function onPlace(btn) {
    var place = btn.getAttribute('data-text');
    if (ui.pending && ui.tab === 'place') {
      var t = place + 'が' + ui.pending;
      speak(t);
      countUp(t);
    } else {
      speak(place);
      countUp(place);
    }
  }

  var handlers = {
    say: onSayPhrase,
    place: onPlace,
    band: function (btn) { speak(btn.getAttribute('data-say')); },
    tab: function (btn) { selectTab(btn.getAttribute('data-tab')); },
    prev: function () { if (ui.page > 0) { ui.page--; renderMain(); } },
    next: function () { ui.page++; renderMain(); },
    unlink: function () { ui.pending = null; renderMain(); },
    krow: function (btn) {
      ui.kanaRow = +btn.getAttribute('data-row') || 0;
      var rows = document.querySelectorAll('#kanaRows .kana');
      for (var i = 0; i < rows.length; i++) {
        var on = i === ui.kanaRow;
        rows[i].classList.toggle('on', on);
        rows[i].setAttribute('aria-pressed', String(on));
      }
      renderKanaChars();
    },
    kadd: function (btn) { if (ui.composed.length < 60) { ui.composed += btn.getAttribute('data-ch'); renderComposer(); } },
    kback: function () { ui.composed = Array.from(ui.composed).slice(0, -1).join(''); renderComposer(); },
    kclear: function () { ui.composed = ''; renderComposer(); },
    kmod: function (btn) { kanaMod(btn.getAttribute('data-mod')); },
    kread: function () { if (ui.composed) speak(ui.composed); }
  };

  function onClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-act], .bandBtn, #display') : null;
    if (!btn || btn.disabled) return;
    if (btn.id === 'display') { if (ui.lastText) speak(ui.lastText); return; }
    if (btn.classList.contains('bandBtn')) { handlers.band(btn); return; }
    var act = btn.getAttribute('data-act');
    if (handlers[act]) handlers[act](btn);
  }

  // ---------- 家族用：3秒長押し ----------
  var lpTimer = null, lpFired = false;
  function bindFamily() {
    var b = $('familyBtn');
    if (!b) return;
    var start = safe(function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      lpFired = false;
      b.classList.add('pressing');
      clearTimeout(lpTimer);
      lpTimer = setTimeout(safe(function () {
        lpFired = true;
        b.classList.remove('pressing');
        try { if (navigator.vibrate) navigator.vibrate(40); } catch (_) {}
        openSettings();
      }), LONG_PRESS_MS);
    });
    var cancel = function () { clearTimeout(lpTimer); b.classList.remove('pressing'); };
    b.addEventListener('pointerdown', start);
    b.addEventListener('pointerup', cancel);
    b.addEventListener('pointercancel', cancel);
    b.addEventListener('pointerleave', cancel);
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    b.addEventListener('click', safe(function () {
      if (lpFired) return;
      var l = $('familyLbl');
      l.innerHTML = 'ご家族が<br>長押し';
      setTimeout(function () { var x = $('familyLbl'); if (x) x.innerHTML = '家族用<br>3秒長押し'; }, 1500);
    }));
  }

  // ---------- 家族用設定画面 ----------
  var setCat = null;
  function openSettings() {
    hideGuide(true);
    if (!setCat || !getCat(setCat)) setCat = data.cats[0] ? data.cats[0].id : null;
    renderSettings();
    $('settings').hidden = false;
    $('settings').querySelector('.setBody').scrollTop = 0;
  }
  function closeSettings() {
    $('settings').hidden = true;
    applyFont();
    renderTabs();
    selectTab(ui.tab);
  }
  function applyFont() {
    document.documentElement.setAttribute('data-font', data.settings.font);
  }
  function msg(id, t) {
    var el = $(id); if (!el) return;
    el.textContent = t;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.textContent = ''; }, 4000);
  }
  function confirmTwice(btn, label, fn) {
    if (btn.classList.contains('confirm')) {
      clearTimeout(btn._t);
      btn.classList.remove('confirm');
      btn.textContent = btn._label || label;
      fn();
      return;
    }
    btn._label = btn.textContent;
    btn.classList.add('confirm');
    btn.textContent = 'もう一度押すと実行';
    btn._t = setTimeout(function () { btn.classList.remove('confirm'); btn.textContent = btn._label; }, 4000);
  }
  function renderVoiceStatus() {
    var el = $('voiceStatus');
    if (!el) return;
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance === 'undefined') {
      el.innerHTML = '<strong>このブラウザは読み上げに対応していません。</strong>文字の表示だけで伝えてください。Android は Chrome、iPhone は Safari をお使いください。';
      return;
    }
    var all = [];
    try { all = window.speechSynthesis.getVoices() || []; } catch (e) {}
    var ja = jaVoices();
    if (!ja.length) {
      el.innerHTML = all.length
        ? '<strong>日本語の音声が見つかりません。</strong>下の手順で日本語の音声をダウンロードしてください。'
        : '<strong>音声の一覧がまだ読み込まれていないか、音声がありません。</strong>「ためしに読む」で声が出るか確認してください。';
      return;
    }
    var v = pickVoice();
    el.innerHTML = '日本語の音声：<strong>' + esc(v.name) + '</strong>' +
      (v.localService ? '（端末内の音声・ネットなしで使えます）' : '（<strong>ネット接続が必要な音声の可能性があります</strong>。機内モードで声が出るか確認してください）');
  }
  function renderSettings() {
    $('ver').textContent = VERSION;
    renderVoiceStatus();
    var opts = document.querySelectorAll('#settings [data-rate]');
    for (var i = 0; i < opts.length; i++) opts[i].setAttribute('aria-pressed', String(Math.abs(parseFloat(opts[i].getAttribute('data-rate')) - data.settings.rate) < 0.01));
    var fo = document.querySelectorAll('#settings [data-font]');
    for (var j = 0; j < fo.length; j++) fo[j].setAttribute('aria-pressed', String(fo[j].getAttribute('data-font') === data.settings.font));
    var sel = $('catSelect');
    sel.innerHTML = data.cats.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === setCat ? ' selected' : '') + '>' + esc(c.name) + '（' + c.phrases.length + '）</option>';
    }).join('');
    renderPhraseList();
  }
  function renderPhraseList() {
    var cat = getCat(setCat), ul = $('phraseList');
    if (!cat) { ul.innerHTML = ''; return; }
    ul.innerHTML = cat.phrases.map(function (x, i) {
      return '<li data-id="' + esc(x.id) + '">' +
        '<input class="setInput pText" type="text" maxlength="40" value="' + esc(x.text) + '" data-sact="edit" aria-label="言葉' + (i + 1) + '">' +
        '<div class="pOpts">' +
        (cat.id === 'place' ? '' :
          '<label><input type="checkbox" data-sact="flag" data-flag="place"' + (x.place ? ' checked' : '') + '>場所につなぐ</label>') +
        '<label><input type="checkbox" data-sact="flag" data-flag="alert"' + (x.alert ? ' checked' : '') + '>目立つ色</label>' +
        '<button type="button" class="setBtn mini" data-sact="up"' + (i === 0 ? ' disabled' : '') + '>↑上へ</button>' +
        '<button type="button" class="setBtn mini" data-sact="down"' + (i === cat.phrases.length - 1 ? ' disabled' : '') + '>↓下へ</button>' +
        '<button type="button" class="setBtn mini danger" data-sact="del">削除</button>' +
        '</div></li>';
    }).join('') || '<li>（まだ言葉がありません）</li>';
  }
  function phraseFromEl(el) {
    var li = el.closest('li[data-id]'); if (!li) return null;
    var cat = getCat(setCat); if (!cat) return null;
    var id = li.getAttribute('data-id');
    for (var i = 0; i < cat.phrases.length; i++) if (cat.phrases[i].id === id) return { cat: cat, i: i, p: cat.phrases[i] };
    return null;
  }
  function onSettingsClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var b = t.closest('button');
    if (!b) return;
    if (b.id === 'setClose' || b.id === 'setClose2') { closeSettings(); return; }
    if (b.id === 'testVoice') { speak('こんにちは。読み上げのテストです。'); setTimeout(safe(renderVoiceStatus), 600); return; }
    if (b.hasAttribute('data-rate')) { data.settings.rate = parseFloat(b.getAttribute('data-rate')); save(); renderSettings(); speak('この速さで読みます'); return; }
    if (b.hasAttribute('data-font')) { data.settings.font = b.getAttribute('data-font'); save(); applyFont(); renderSettings(); return; }
    if (b.id === 'addPhrase') {
      var inp = $('newPhrase'), v = inp.value.trim(), cat = getCat(setCat);
      if (!v) { msg('phraseMsg', '言葉を入力してください'); return; }
      if (!cat) return;
      cat.phrases.push({ id: uid(), text: v });
      save(); inp.value = ''; renderSettings();
      msg('phraseMsg', '「' + v + '」を「' + cat.name + '」に追加しました');
      return;
    }
    if (b.id === 'addCat') {
      var ci = $('newCat'), name = ci.value.trim();
      if (!name) { msg('catMsg', 'カテゴリ名を入力してください'); return; }
      var nc = { id: 'c' + uid(), name: name, phrases: [] };
      data.cats.push(nc); save(); ci.value = ''; setCat = nc.id; renderSettings();
      msg('catMsg', '「' + name + '」を追加しました。上の「言葉の編集」で言葉を入れてください');
      return;
    }
    if (b.id === 'delCat') {
      var dc = getCat(setCat);
      if (!dc) return;
      if (dc.builtin) { msg('catMsg', '最初からあるカテゴリは削除できません（言葉の削除はできます）'); return; }
      confirmTwice(b, '選択中のカテゴリを削除', function () {
        data.cats = data.cats.filter(function (c) { return c.id !== dc.id; });
        save(); setCat = data.cats[0] ? data.cats[0].id : null; renderSettings();
        msg('catMsg', '「' + dc.name + '」を削除しました');
      });
      return;
    }
    if (b.id === 'resetCounts') {
      confirmTwice(b, '使用回数をリセット', function () { data.counts = {}; save(); msg('resetMsg', '使用回数をリセットしました'); });
      return;
    }
    if (b.id === 'resetAll') {
      confirmTwice(b, '言葉を初期状態に戻す', function () {
        data.cats = defaultCats(); data.counts = {}; save(); setCat = data.cats[0].id; renderSettings();
        msg('resetMsg', '言葉を初期状態に戻しました');
      });
      return;
    }
    var sact = b.getAttribute('data-sact');
    if (!sact) return;
    var f = phraseFromEl(b);
    if (!f) return;
    if (sact === 'up' && f.i > 0) { f.cat.phrases.splice(f.i, 1); f.cat.phrases.splice(f.i - 1, 0, f.p); save(); renderPhraseList(); }
    else if (sact === 'down' && f.i < f.cat.phrases.length - 1) { f.cat.phrases.splice(f.i, 1); f.cat.phrases.splice(f.i + 1, 0, f.p); save(); renderPhraseList(); }
    else if (sact === 'del') {
      confirmTwice(b, '削除', function () {
        f.cat.phrases.splice(f.i, 1);
        delete data.counts[f.p.text];
        save(); renderSettings();
        msg('phraseMsg', '「' + f.p.text + '」を削除しました');
      });
    }
  }
  function onSettingsChange(e) {
    var t = e.target;
    if (t.id === 'catSelect') { setCat = t.value; renderPhraseList(); return; }
    var sact = t.getAttribute && t.getAttribute('data-sact');
    if (!sact) return;
    var f = phraseFromEl(t);
    if (!f) return;
    if (sact === 'edit') {
      var v = t.value.trim();
      if (!v) { t.value = f.p.text; msg('phraseMsg', '空にはできません（消すときは「削除」）'); return; }
      if (v !== f.p.text) {
        if (data.counts[f.p.text]) { data.counts[v] = data.counts[f.p.text]; delete data.counts[f.p.text]; }
        f.p.text = v; save(); msg('phraseMsg', '「' + v + '」に変更しました');
      }
    } else if (sact === 'flag') {
      var fl = t.getAttribute('data-flag');
      if (t.checked) f.p[fl] = true; else delete f.p[fl];
      save();
    }
  }

  // ---------- 起動 ----------
  function init() {
    data = load();
    save();
    applyFont();
    $('display').classList.add('idle');
    document.addEventListener('click', safe(onClick));
    $('settings').addEventListener('click', safe(function (e) { e.stopPropagation(); onSettingsClick(e); }));
    $('settings').addEventListener('change', safe(onSettingsChange));
    $('guideGo').addEventListener('click', safe(function (e) {
      e.stopPropagation();
      var p = ui.pending;
      selectTab('place');
      ui.pending = p;
      renderMain();
    }));
    $('guideClose').addEventListener('click', safe(function (e) { e.stopPropagation(); clearPending(); }));
    renderTabs();
    selectTab(topFavs().length ? 'fav' : 'body');

    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.getVoices();
        var onVoices = safe(function () { voiceCache = null; if (!$('settings').hidden) renderVoiceStatus(); });
        if (window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', onVoices);
        else window.speechSynthesis.onvoiceschanged = onVoices;
      }
    } catch (e) {}

    // 表示の文字サイズは画面サイズが変わったら合わせ直す
    var lastH = window.innerHeight;
    window.addEventListener('resize', safe(function () {
      if (ui.lastText) setDisplay(ui.lastText);
      if (Math.abs(window.innerHeight - lastH) > 40 && ui.tab !== 'kana' && $('settings').hidden) { lastH = window.innerHeight; ui.page = 0; renderMain(); }
    }));

    // Service Worker（2回目以降はネットなしで即起動）
    try {
      if ('serviceWorker' in navigator && window.isSecureContext) {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      }
    } catch (e) {}
  }

  // どんなエラーでも画面を止めない
  window.addEventListener('error', function (e) { try { e.preventDefault(); } catch (_) {} });
  window.addEventListener('unhandledrejection', function (e) { try { e.preventDefault(); } catch (_) {} });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safe(init));
  else safe(init)();
})();
