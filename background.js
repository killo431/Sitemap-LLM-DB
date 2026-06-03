const _state = {
  initialized     : false,
  srcTabId        : null,
  rootUrl         : null,
  baseDomain      : null,
  waitingUrls     : null,
  doneUrls        : null,
  currentUrl      : null,
  data            : null,
  externalDomains : null,
  isAsync         : null,
  isPending       : null,
  isQueryIgnore   : null,
  isTargetAll     : null,
  ignoreRegExps   : null,
  includeSubDomain: null,
  pendingCountIdx : null,
  skipSimilar     : null,
  isSlow          : null,
  similarCheckUrls: null,
};

const _initParams = (srcTabId, rootUrl, baseDomain) => {
  _state.initialized = true;
  _state.srcTabId = srcTabId;
  _state.rootUrl = rootUrl;
  _state.waitingUrls = [_state.rootUrl];
  _state.baseDomain = baseDomain;
  _state.currentUrl = null;
  _state.isPending = null;
  _state.doneUrls = [];
  _state.data = [];
  _state.externalDomains = [];
  _state.pendingCountIdx = {};
  _state.similarCheckUrls = [];
  return _setStorage();
};

const _start = (request) => {
  console.log('_start', request);
  const {
    srcUrl,
    srcTabId,
    isAsync,
    isQueryIgnore,
    isTargetAll,
    ignoreRegExps,
    includeSubDomain,
    skipSimilar,
    isSlow
  } = request;
  _state.isAsync = isAsync;
  _state.isQueryIgnore = isQueryIgnore;
  _state.isTargetAll = isTargetAll;
  _state.ignoreRegExps = ignoreRegExps;
  _state.includeSubDomain = includeSubDomain;
  _state.skipSimilar = skipSimilar;
  _state.isSlow = isSlow;
  const rootUrl = isTargetAll ? _getRootUrl(srcUrl) : _cleanUrl(srcUrl);
  const baseDomain = _getBaseDomain(rootUrl);
  console.info('[baseDomain]', baseDomain);
  _initParams(srcTabId, rootUrl, baseDomain).then(() => {
    //open main tab
    // const url = chrome.runtime.getURL('main.html');
    // chrome.tabs.create({url});

    _next();
  });
};

const _next = () => {
  _state.currentUrl = _state.waitingUrls.splice(0, 1)[0];
  console.log('_next url:', _state.currentUrl)
  if (_state.currentUrl) {
    if (_state.isAsync) {
      _setStorage().then(() => {
        chrome.tabs.update(_state.srcTabId, {url: _state.currentUrl});
      });
    } else {
      setTimeout(()=> {
        _sendTabMessage({
          type          : 'fetch',
          url           : _state.currentUrl,
          progressStatus: _getProgressStatus(),
        });
      },  _state.isSlow ? 500 : 0);
    }
  } else {
    _allComplete();
  }
};

const _push = (request) => {
  let {info, links, realUrl} = request;
  console.log('_push', info);
  if (!_state.doneUrls) {
    console.info({
      _start,
      _next,
      _state,
    });
    console.info('_state.doneUrls is undefined! -> runtime.id', chrome.runtime.id);
  }

  realUrl = _cleanUrl(realUrl);
  if (!_state.doneUrls.includes(_state.currentUrl)) _state.doneUrls.push(_state.currentUrl);
  if (realUrl !== _state.currentUrl) {
    if (!_state.doneUrls.includes(realUrl)) _state.doneUrls.push(realUrl);
  }

  const redirectSrcUrl = (_state.currentUrl !== realUrl) ? _state.currentUrl : '';

  _state.data.push({
    url: realUrl,
    redirectSrcUrl,
    info,
  });

  links.forEach((url) => {
    url = _cleanUrl(url);

    if (_state.waitingUrls.includes(url) || _state.doneUrls.includes(url) || _state.currentUrl === url) return;

    //test ignore
    const dir = '/' + url.split('/').slice(3).join('/');
    let matchIgnore = false;
    _state.ignoreRegExps.forEach((regStr) => {
      const reg = new RegExp(regStr);
      if (dir.match(reg) || url.match(reg)) matchIgnore = true;
    });
    if (matchIgnore) {
      console.info('url push skipped.', dir, _state.ignoreRegExps);
      return;
    }

    //似たURLをスキップ（数字・全角を削除して比較）
    if (_state.skipSimilar) {
      let isSimilar = false;
      _state.similarCheckUrls.forEach((checkUrl) => {
        if (url.match(new RegExp(checkUrl))) isSimilar = true;
      });
      if (isSimilar) {
        console.info(`[similar skipped] ${url}`);
        return;
      }
      const checkUrl = decodeURIComponent(url)
        .split('/')
        .map((str) => {
          if (!str) return str;
          if (str.replace(/[0-9]+/g, '') === '') return '[0-9]+';//数字だけディレクトリ（日付）
          if (str.match(/[ぁ-んァ-ン一-龥]/)) return '.+';//全角を含むディレクトリ
          str = str.replace(/[0-9]+\..+/, '[0-9]+\..+');//「entry-12.html」みたいなやつ
          return str;
        })
        .join('/');
      if (checkUrl !== url) {
        if (_state.similarCheckUrls.includes(checkUrl)) return;
        console.info(`[similar check url added] ${checkUrl}`);
        _state.similarCheckUrls.push(checkUrl);
      }
    }


    //root URLにマッチするか
    const domain = url.split('/')[2] || '';
    const rootDomain = _state.rootUrl.split('/')[2];
    let matchRoot = _state.includeSubDomain ? domain.includes(_state.baseDomain) : domain === rootDomain;
    if (!_state.isTargetAll) {
      //サブディレクトリのみ
      if (!url.includes(_state.rootUrl)) matchRoot = false;
    }

    if (matchRoot) {
      _state.waitingUrls.push(url);
      _state.waitingUrls.sort((a, b) => a.split('/').join('') < b.split('/').join('') ? -1 : 1);//「/」がはいっているとうまくソートされない
    } else {
      const externalUrl = _getRootUrl(url);
      if (!_state.externalDomains.includes(externalUrl)) _state.externalDomains.push(externalUrl);
    }
  });

  _next();
};

const _allComplete = () => {
  _sendTabMessage({
    type            : 'all_complete',
    rootUrl         : _state.rootUrl,
    data            : _state.data,
    externalDomains : _state.externalDomains,
    skipSimilar     : _state.skipSimilar,
    isSlow          : _state.isSlow,
    similarCheckUrls: _state.similarCheckUrls,
  }).then(() => {
    _initParams('', '', '');
  });
}

const _getProgressStatus = () => {
  return {
    doneCount   : (_state.data || []).length,
    waitingCount: (_state.waitingUrls || []).length,
  };
};

const _addUrlLastSlash = (url) => {
  //ディレクトリの場合、最後は必ず/で終わるように
  const urlArr = url.split('/');
  let lastDir = urlArr[urlArr.length - 1] || urlArr[urlArr.length - 2];
  const hasQueryOrExtension = lastDir.match(/(\?|\.)/);
  if (!hasQueryOrExtension && !url.match(/(tel|mailto):/) && url.substr(-1) !== '/') {
    url += '/';
  }
  return url;
};

const _cleanUrl = (url) => {
  //index.html削除
  url = url.replace(/index\.(html|php)/, '');

  //
  url = url.split('#')[0];
  url = _addUrlLastSlash(url);
  if (_state.isQueryIgnore) {
    url = url.split('?')[0];
    url = _addUrlLastSlash(url);
  }

  //httpのURLをhttpsに
  if (_state.rootUrl && _state.rootUrl.includes('https://')) {
    url = url.split('http://').join('https://');
  }

  return url;
};

const _getBaseDomain = (url) => {
  const domain = url.split('/')[2];

  const wordArr = domain.split('.');
  let suffix = wordArr[wordArr.length - 1];
  let mainIndex = wordArr.length - 2;
  const last2 = wordArr[wordArr.length - 2];
  if (['com', 'net', 'or', 'org', 'ac'].includes(last2)) {
    //「com.cn」「or.jp」などに対応
    suffix = last2 + '.' + suffix;
    mainIndex = wordArr.length - 3;
  }

  return wordArr[mainIndex] + '.' + suffix;
};

const _getRootUrl = (url) => {
  url = url.split('/').slice(0, 3).join('/');
  if (!url.match(/(tel|mailto):/)) url += '/';
  return url;
};


const _sendTabMessage = (msg) => {
  return _setStorage().then(() => {
    chrome.tabs.sendMessage(_state.srcTabId, msg);
  });
};

const _setStorage = () => {
  return new Promise((f, r) => {
    chrome.storage.local.set({state: _state}, f);
  });
};

const _restoreStateIfNeeded = () => {
  return new Promise((f, r) => {
    if (_state.initialized) return f();

    chrome.storage.local.get(['state'], (result) => {
      console.info('state is restored!', result);
      Object.assign(_state, result.state);
      f();
    });
  });
};


console.log('chrome.runtime.id', chrome.runtime.id);
chrome.runtime.onInstalled.addListener(async () => console.log('onInstalled'));
chrome.runtime.onConnect.addListener(async () => console.log('onConnect'));
chrome.runtime.onStartup.addListener(async () => console.log('onStartup'));
chrome.runtime.onSuspend.addListener(async () => console.log('onSuspend'));
chrome.runtime.onSuspendCanceled.addListener(async () => console.log('onSuspendCanceled'));
chrome.runtime.onUpdateAvailable.addListener(async () => console.log('onUpdateAvailable'));

chrome.runtime.onMessage.addListener((request, sender, callback) => {
  const tab = sender.tab;

  //何らかのタイミングで保持した変数が初期化されてしまうのでstorageから復元
  _restoreStateIfNeeded().then(() => {

    console.info('request / state', request, _state);

    switch (request.type) {
      case 'content_ready':
        const isActiveTab = tab.id === _state.srcTabId;
        callback({
          needSendHtml  : isActiveTab,
          isAsync       : _state.isAsync,
          progressStatus: _getProgressStatus(),
        });

        //別ドメインから遷移してきてfetch再開
        if (_state.isPending && isActiveTab) {
          _state.isPending = false;
          _setStorage().then(() => {
            _next();
          });
        }
        break;

      case 'start':
        _start(request);
        callback();
        break;

      case 'fetch_pending':
        //何度も同じURLを繰り返す場合はそのドメインは除外してしまう（dev環境で本番URLからdevにリダイレクトしているときなど）
        const retryUrl = _state.currentUrl;
        if (!_state.pendingCountIdx[retryUrl]) _state.pendingCountIdx[retryUrl] = 0;
        _state.pendingCountIdx[retryUrl]++;
        if (_state.pendingCountIdx[retryUrl] >= 3) {
          console.info(`pending canceled`);
          const retryDomain = retryUrl.split('/')[2];
          const len = _state.waitingUrls.length;
          _state.waitingUrls.slice().reverse().forEach((url, i) => {
            const index = len - 1 - i;
            if (url.includes(retryDomain)) {
              const rejectUrl = _state.waitingUrls.splice(index, 1)[0];
              console.info(`[url rejected] ${rejectUrl}`);
            }
          });
          _next();
          break;//callbackは叩かない
        }

        _state.isPending = true;
        _state.waitingUrls.unshift(retryUrl);//先頭追加
        _setStorage().then(() => {
          callback();
        });
        break;

      case 'push':
        _push(request);
        callback();
        break;

      default:
        callback();
        break;
    }

  });

  return true;//空でもよいので返す
});
