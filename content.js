let _scrollTimeout = false;

const _domReady = () => {
  if (document.readyState != 'loading') return Promise.resolve();
  return new Promise((f, r) => {
    document.addEventListener('DOMContentLoaded', f);
  });
}

Promise.race([
  new Promise((f, r) => setTimeout(f, 5000)),
  _domReady().then(() => {
    return new Promise((f, r) => setTimeout(f, 100));
  }),
]).then(() => {

  chrome.runtime.sendMessage({type: 'content_ready', url: location.href}, (res) => {
    res = res || {};
    const {needSendHtml, isAsync, progressStatus} = res;
    if (needSendHtml && isAsync) {
      _updateProgressStatus(progressStatus);

      //start
      Promise.race([
        new Promise((f, r) => setTimeout(f, 1000)),
        new Promise((f, r) => window.addEventListener('load', f)),
      ]).then(() => {
        _scrollDown();
      });

      //タイムアウト：ページ側でエラーがあるときにscroll検知が実行できないので
      setTimeout(() => {
        _scrollTimeout = true;
        _sendHtml(_getHtml(), location.href);
      }, 15 * 1000);
    }
  });

});

const _scrollTarget = (document.scrollingElement || document.documentElement);
const _scrollDown = () => {
  const oldTop = _scrollTarget.scrollTop;
  _scrollTarget.scrollTop = oldTop + 2000;
  setTimeout(() => {
    const scrollableMore = document.body.offsetHeight > (_scrollTarget.scrollTop + window.innerHeight);
    if (oldTop === _scrollTarget.scrollTop && !scrollableMore) {
      if (_scrollTimeout) return;
      _sendHtml(_getHtml(), location.href);
    } else {
      _scrollDown();
    }
  }, 500);
};

const _getHtml = () => {
  const html = document.getElementsByTagName('html')[0];
  return `
  <html>
  ${html.innerHTML}
  </html>`;
}

const _fetchHtml = (url, progressStatus) => {

  const currentHref = location.href.split('?')[0].split('#')[0];
  if (url === currentHref) {
    console.log(_getHtml());
    _sendHtml(_getHtml(), url);
    return Promise.resolve();
  }

  //別ドメインをfetchするときはページを移動する（httpsとhttpsの違いもあったりするので、ドメインでなくhttpからの比較）
  const newDomain = url.split('/').slice(0, 3).join('/');
  const currentDomain = location.href.split('/').slice(0, 3).join('/');
  if (newDomain !== currentDomain) {
    chrome.runtime.sendMessage({type: 'fetch_pending', url: url}, (res) => {
      location.href = url;
    });
    return;
  }

  _updateProgressStatus(progressStatus);

  //logoutしないように
  if (url.toLowerCase().includes('/logout/')) {
    _sendHtml(`<html><head><title>logout</title></head><body></body></html>`, url);
    return;
  }

  fetch(url, {
    credentials   : 'same-origin',//ブラウザがもってる認証情報でbasic認証を突破
    redirect      : 'follow',
    referrerPolicy: 'no-referrer',
  })
    .then((res) => {
      if (!res.ok) throw Error(res.statusText);

      const res2 = res.clone();

      return new Promise((f, r) => {
        res.text().then((text) => {
          let irregularEncoding = '';
          const t = text.toLowerCase();
          if (t.includes('charset=shift_jis')) irregularEncoding = 'shift-jis';
          if (t.includes('charset=windows-31j')) irregularEncoding = 'Windows-31J';

          if (!irregularEncoding) {
            return f(text);
          }

          //shift_jisを変換
          res2.arrayBuffer().then((arrayBuffer) => {
            const html = new TextDecoder(irregularEncoding).decode(arrayBuffer);
            f(html);
          });
        });
      });
    })
    .then((html) => {
      _sendHtml(html, url);
    })
    .catch((err) => {
      console.log('err', err);
      _sendHtml('', url);
    });
};

const _sendHtml = (html, url) => {
  chrome.runtime.sendMessage({
    type   : 'push',
    info   : _html2info(html),
    links  : _html2links(html),
    realUrl: url,
  }, (res) => {
  });
};

const _html2info = (html) => {
  const title = (html.split('<title>')[1] || '').split('</title>')[0];

  let _description = '';
  let _ogImage = '';
  html.split('<meta ').slice(1).forEach((line) => {
    const attrs = line.split('>')[0];
    if (attrs.includes('name="description"')) {
      _description = (attrs.match(/content="(.*?)"/) || [])[1];
    }
    if (attrs.includes('property="og:image"')) {
      _ogImage = (attrs.match(/content="(.*?)"/) || [])[1];
    }
  });

  return {
    notFound   : !html,
    title      : title || '',
    description: _description || '',
    ogImage    : _ogImage || '',
  };
};

const _a = document.createElement('a');
const _html2links = (html) => {
  const links = [];

  html.split('<a ').slice(1).forEach((line) => {
    const attrs = line.split('>')[0];
    const href = (attrs.match(/href="(.*?)"/) || [])[1];
    if (!href) return;
    if (href.toLowerCase().match(/\.(jpeg|jpg|png|gif|svg|zip|pdf)/)) return;
    _a.href = href;
    const url = _a.href;
    if (!links.includes(url)) links.push(url);
  });

  return links;
};

let _statusEl;
const _updateProgressStatus = (progressStatus) => {
  _makeStatusEl();

  if (!progressStatus) return;

  _statusEl.querySelector('.crawlerStatus_msg').innerHTML = `
crawling...<br>
<br>
done: ${progressStatus.doneCount}<br>
waiting: ${progressStatus.waitingCount + 1}<br>
total: ${progressStatus.doneCount + progressStatus.waitingCount + 1}<br>
  `
};

const _makeStatusEl = () => {
  if (_statusEl) return;
  const head = document.getElementsByTagName('head')[0];
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = chrome.runtime.getURL('content.css');
  head.appendChild(link);

  _statusEl = document.createElement('div');
  _statusEl.id = 'crawlerStatus';
  _statusEl.classList.add('crawlerStatus');
  document.body.appendChild(_statusEl);

  _statusEl.innerHTML = `
<div class="crawlerStatus_inner">
  <div class="crawlerStatus_msg"></div>
</div>
  `;
};

const _allComplete = (msg) => {
  if (!_statusEl) _makeStatusEl();
  const {rootUrl, data, externalDomains, similarCheckUrls, skipSimilar, isSlow} = msg;

  //404ページの数
  const notFoundUrls = [];
  data.forEach((item) => {
    if (item.info.notFound) {
      notFoundUrls.push(item.url);
    }
  });
  const notFoundCount = notFoundUrls.length;
  const okCount = data.length - notFoundCount;

  //
  _statusEl.innerHTML = `
<div class="crawlerStatus_inner">
  <div class="crawlerStatus_msg">
    crawl has been completed !<br>
    <br>
    total: ${data.length}<br>
    (ok: ${okCount} / not_found: ${notFoundCount})<br>
    <br>
  </div>
  <div class="crawlerStatus_result">
    <section class="crawlerStatus_resultSection">
      <h2 class="crawlerStatus_resultHead">サイトマップ（<a href="https://sheets.new" target="_blank">スプレッドシート</a> or エクセルにコピペしてください）</h2>
      <nav class="crawlerStatus_resultNav">
        <ul class="crawlerStatus_resultNavOption" data-name="include404">
          <li><button data-value="no">404ページを除外</button></li>
          <li><button data-value="yes">404ページを含める</button></li>
        </ul>
      </nav>
      <textarea class="crawlerStatus_resultText" name="sitemap" onfocus="this.select();"></textarea>
    </section>
    <section class="crawlerStatus_resultSection">
      <h2 class="crawlerStatus_resultHead">外部ドメイン一覧</h2>
      <textarea class="crawlerStatus_resultText" name="externals"></textarea>
    </section>
    <section class="crawlerStatus_resultSection">
      <h2 class="crawlerStatus_resultHead">リンク切れURL一覧（404, not found）</h2>
      <textarea class="crawlerStatus_resultText" name="notfound"></textarea>
    </section>
  </div>
</div>
  `;


  //外部ドメイン
  _qs('.crawlerStatus_resultText[name="externals"]')[0].value = externalDomains.sort((a, b) => a < b ? -1 : 1).join('\n');

  //404
  _qs('.crawlerStatus_resultText[name="notfound"]')[0].value = notFoundUrls.sort((a, b) => a < b ? -1 : 1).join('\n');

  //サイトマップ
  const sortedData = data.sort((a, b) => a.url.split('/').join('') < b.url.split('/').join('') ? -1 : 1);//「/」がはいっているとうまくソートされない
  const dataIdx = {};
  let maxDepth = 0;
  sortedData.forEach((item) => {
    dataIdx[item.url] = item;
    maxDepth = Math.max(maxDepth, item.url.split('/').length - 4);
  });
  // maxDepth = 10;//いったん10で固定

  const _condition = {
    include404: false,
  };

  const format = () => {
    const headIndent = _range(maxDepth).map(() => '\t').join('');
    const sitemapHead = _compact([
      _condition.include404 ? '404' : null,
      'name' + headIndent,
      'dir' + headIndent,
      'url',
      skipSimilar ? 'similar_url' : null,
      'title',
      'description',
      'og:image',
      'redirect_src_url',
    ]).join('\t');

    const splitTitle = (title) => {
      title = title.split('｜').join('|').split(' - ').join('|');
      return title.split('|').map((word) => word.trim());
    };

    const rows = [];

    sortedData.forEach((item) => {
      const {info, url, redirectSrcUrl} = item;
      const {notFound, title, description, ogImage} = info;

      const dirArr = url.split('/');
      const isTopLevel = !dirArr[3];//
      const isRoot = url === rootUrl;//
      const lastDirName = dirArr[dirArr.length - 1];
      const isFile = !isTopLevel && lastDirName.includes('.');//「.html」とか
      let upToParent = isFile ? 1 : 2;
      let parentUrl = dirArr.slice(0, dirArr.length - upToParent).join('/') + '/';
      let depth = parentUrl.split('/').length - 3;
      let parentItem = dataIdx[parentUrl];
      let dir = parentItem ? '/' + dirArr.slice(dirArr.length - upToParent).join('/') : '/' + dirArr.slice(3).join('/');
      const backToParent = () => {
        depth--;
        upToParent++;
        dir = '/' + dirArr.slice(dirArr.length - upToParent).join('/');
        parentUrl = dirArr.slice(0, dirArr.length - upToParent).join('/') + '/';
        parentItem = dataIdx[parentUrl];
      };
      if (!isTopLevel && !parentItem && !isRoot) {
        backToParent();
        if (!parentItem) backToParent();
        if (!parentItem) backToParent();
        if (!parentItem) backToParent();
        if (!parentItem) backToParent();
      }

      const indentBefore = _range(depth).map(() => '\t').join('');
      const indentAfter = _range(maxDepth - depth).map(() => '\t').join('');

      //似たURL形式のページあり
      let hasSimilarUrl = false;
      similarCheckUrls.forEach((checkUrl) => {
        if (url.match(new RegExp(checkUrl))) hasSimilarUrl = true;
      });

      //ページ名
      const titleArr = splitTitle(title);
      let name = titleArr[0];
      if (parentItem) {
        //親と重複部分を除外
        name = name.split(parentItem.info.title).join('').trim();

        //親と同じタイトルになってしまった場合は後方一致
        const parentTitleArr = splitTitle(parentItem.info.title);
        if (name === parentTitleArr[0]) {
          name = titleArr[titleArr.length - 1];
          if (parentItem.info.title.includes(name)) name = '';//親に含まれる場合は後方一致も意味ないので空に
        }
      } else {
        if (isTopLevel) {
          // name = 'トップ';
        }
      }

      const dirDecoded = decodeURIComponent(dir);//ブログなどURLに日本語が入っている場合に見やすくする
      const mark404 = notFound ? '◯' : '-';
      const markSimilar = hasSimilarUrl ? '◯' : '-';

      if (!_condition.include404 && notFound) return null;

      const row = _compact([
        _condition.include404 ? mark404 : null,
        indentBefore + name + indentAfter,
        indentBefore + dirDecoded + indentAfter,
        url,
        skipSimilar ? markSimilar : null,
        title,
        description,
        ogImage,
        redirectSrcUrl,
      ]).join('\t')
        .split('\r\n').join('\n')
        .split('\r').join('\n')
        .split('\n').join(' ');

      rows.push(row);
    });

    const sitemapBody = rows.join('\n');
    return sitemapHead + '\n' + sitemapBody;
  };

  const _resultEl = _qs('.crawlerStatus_resultText[name="sitemap"]')[0];
  const _navChanged = () => {
    _options.forEach((option) => {
      let value = option.getValue();
      if (value === 'yes') value = true;
      else if (value === 'no') value = false;
      _condition[option.getName()] = value;
    });
    _resultEl.value = format();
    console.log('_condition', _condition);
  }

  class NavOption {
    constructor(el) {
      this._name = el.getAttribute('data-name');
      this._values = [];
      this._btns = Array.prototype.slice.call(el.querySelectorAll('button')).map((button, i) => {
        this._values.push(button.getAttribute('data-value'));
        button.addEventListener('click', this._changed.bind(this, i, false));
        return button;
      });
      this._changed(0, true);
    }

    _changed(index, noEmit) {
      if (this._index === index) return;
      this._index = index;
      this._value = this._values[index];
      this._btns.forEach((button, i) => {
        button.classList[i === index ? 'add' : 'remove']('is_active');
      });
      if (!noEmit) {
        _navChanged();
      }
    }

    getName() {
      return this._name;
    }

    getValue() {
      return this._value;
    }
  }

  const _options = _qs('.crawlerStatus_resultNavOption').map((el) => {
    return new NavOption(el);
  });

  //start
  _navChanged();


  setTimeout(() => {
    alert('crawl has been completed!');
  }, 33);
}

const _qs = (expr) => {
  return Array.prototype.slice.call(document.querySelectorAll(expr));
};


const _getRadioValue = (name) => {
  let res = '';
  qs(`[name="${name}"]`).forEach((radio) => {
    if (radio.checked) res = radio.value;
  });
  return res;
};

const _range = (num) => {
  const res = [];
  for (let i = 0; i < num; i++) {
    res.push(i);
  }
  return res;
}

const _compact = (arr) => {
  const newArr = [];
  arr.forEach((item) => {
    if (!item && item !== 0 && item !== '') return;//空文字列と0は許容
    newArr.push(item);
  });
  return newArr;
};

chrome.runtime.onMessage.addListener((msg) => {
  console.info('msg', msg);

  switch (msg.type) {
    case 'fetch':
      _fetchHtml(msg.url, msg.progressStatus);
      break;

    case 'all_complete':
      _allComplete(msg);
      break;
  }

  return true;//空でもよいので返す
});
