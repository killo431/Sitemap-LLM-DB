const _DEFAULT_STATE = {
  initialized: false,
  paused: false,
  automatedRun: false,
  srcTabId: null,
  rootUrl: null,
  baseDomain: null,
  waitingUrls: [],
  doneUrls: [],
  inProgressUrls: [],
  currentUrl: null,
  data: [],
  externalDomains: [],
  isAsync: false,
  isPending: false,
  isQueryIgnore: true,
  isTargetAll: false,
  ignoreRegExps: [],
  includeSubDomain: false,
  pendingCountIdx: {},
  skipSimilar: false,
  isSlow: false,
  similarCheckUrls: [],
  concurrency: 1,
  respectRobots: true,
  customHeaders: [],
  customCookies: '',
  robotsDisallowPatterns: [],
  useCloudSync: false,
  projectNote: '',
};

const _state = {..._DEFAULT_STATE};
let _schedules = [];
let _projectSettings = {
  concurrency: 3,
  respectRobots: true,
  customHeaders: [],
  customCookies: '',
  useCloudSync: false,
  projectNote: '',
};

const _storageLocalGet = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const _storageLocalSet = (payload) => new Promise((resolve) => chrome.storage.local.set(payload, resolve));
const _storageSyncGet = (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
const _storageSyncSet = (payload) => new Promise((resolve) => chrome.storage.sync.set(payload, resolve));
const _clearAlarm = (name) => new Promise((resolve) => chrome.alarms.clear(name, resolve));

const _setStorage = async () => {
  await _storageLocalSet({state: _state});
};

const _sendNotification = (title, message) => {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title,
    message,
  });
};

const _tabsUpdate = (tabId, payload) => new Promise((resolve) => {
  chrome.tabs.update(tabId, payload, () => resolve(!chrome.runtime.lastError));
});

const _tabsCreate = (payload) => new Promise((resolve) => {
  chrome.tabs.create(payload, (tab) => {
    if (chrome.runtime.lastError) return resolve(null);
    resolve(tab);
  });
});

const _sendTabMessage = (msg, tabId = _state.srcTabId) => new Promise((resolve) => {
  if (!tabId) return resolve(false);
  chrome.tabs.sendMessage(tabId, msg, () => {
    resolve(!chrome.runtime.lastError);
  });
});

const _restoreStateIfNeeded = async () => {
  if (_state.initialized || _state.rootUrl || (_state.waitingUrls || []).length || (_state.inProgressUrls || []).length) return;
  const result = await _storageLocalGet(['state', 'schedules', 'projectSettings']);
  if (result.state) Object.assign(_state, _DEFAULT_STATE, result.state);
  if (result.schedules) _schedules = result.schedules;
  if (result.projectSettings) _projectSettings = {..._projectSettings, ...result.projectSettings};

  if (_projectSettings.useCloudSync) {
    const syncRes = await _storageSyncGet(['schedules', 'projectSettings']);
    if (syncRes.schedules && syncRes.schedules.length) _schedules = syncRes.schedules;
    if (syncRes.projectSettings) _projectSettings = {..._projectSettings, ...syncRes.projectSettings};
  }
};

const _getProgressStatus = () => ({
  doneCount: (_state.doneUrls || []).length,
  waitingCount: (_state.waitingUrls || []).length,
  inProgressCount: (_state.inProgressUrls || []).length,
});

const _buildStatus = () => ({
  initialized: !!_state.initialized,
  paused: !!_state.paused,
  rootUrl: _state.rootUrl,
  ..._getProgressStatus(),
});

const _addUrlLastSlash = (url) => {
  const urlArr = url.split('/');
  const lastDir = urlArr[urlArr.length - 1] || urlArr[urlArr.length - 2] || '';
  const hasQueryOrExtension = lastDir.match(/(\?|\.)/);
  if (!hasQueryOrExtension && !url.match(/(tel|mailto):/) && url.substr(-1) !== '/') url += '/';
  return url;
};

const _cleanUrl = (url = '') => {
  if (!url) return '';
  url = url.replace(/index\.(html|php)/, '');
  url = url.split('#')[0];
  url = _addUrlLastSlash(url);
  if (_state.isQueryIgnore) {
    url = url.split('?')[0];
    url = _addUrlLastSlash(url);
  }
  if (_state.rootUrl && _state.rootUrl.includes('https://')) {
    url = url.split('http://').join('https://');
  }
  return url;
};

const _getBaseDomain = (url) => {
  const domain = (url.split('/')[2] || '').toLowerCase();
  const wordArr = domain.split('.').filter(Boolean);
  if (wordArr.length < 2) return domain;
  let suffix = wordArr[wordArr.length - 1];
  let mainIndex = wordArr.length - 2;
  const last2 = wordArr[wordArr.length - 2];
  if (['com', 'net', 'or', 'org', 'ac', 'co'].includes(last2) && wordArr.length >= 3) {
    suffix = `${last2}.${suffix}`;
    mainIndex = wordArr.length - 3;
  }
  return `${wordArr[mainIndex]}.${suffix}`;
};

const _getRootUrl = (url = '') => {
  url = url.split('/').slice(0, 3).join('/');
  if (!url.match(/(tel|mailto):/) && url && url.substr(-1) !== '/') url += '/';
  return url;
};

const _parseHeaderLines = (lines = []) => {
  const headers = {};
  lines.forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key || !value) return;
    headers[key] = value;
  });
  return headers;
};

const _loadRobots = async (rootUrl) => {
  if (!_state.respectRobots) {
    _state.robotsDisallowPatterns = [];
    return;
  }
  const robotsUrl = `${_getRootUrl(rootUrl)}robots.txt`;
  try {
    const res = await fetch(robotsUrl);
    if (!res.ok) {
      _state.robotsDisallowPatterns = [];
      return;
    }
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    let inGlobalAgent = false;
    const disallowPaths = [];
    lines.forEach((line) => {
      const cleaned = line.split('#')[0].trim();
      if (!cleaned) return;
      const [kRaw, ...rest] = cleaned.split(':');
      const key = (kRaw || '').trim().toLowerCase();
      const value = rest.join(':').trim();
      if (key === 'user-agent') {
        inGlobalAgent = value === '*' || value.toLowerCase() === 'sitemap-llm-db';
      }
      if (key === 'disallow' && inGlobalAgent && value) disallowPaths.push(value);
    });
    _state.robotsDisallowPatterns = disallowPaths;
  } catch (e) {
    _state.robotsDisallowPatterns = [];
  }
};

const _isDisallowedByRobots = (url) => {
  if (!_state.respectRobots) return false;
  const domain = _getRootUrl(url);
  if (domain !== _getRootUrl(_state.rootUrl)) return false;
  const path = '/' + url.split('/').slice(3).join('/');
  return (_state.robotsDisallowPatterns || []).some((rule) => {
    if (!rule || rule === '/') return true;
    if (rule === '') return false;
    if (rule.includes('*')) {
      const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${escaped}`).test(path);
    }
    return path.startsWith(rule);
  });
};

const _enqueueUrl = (url) => {
  url = _cleanUrl(url);
  if (!url || url.match(/^(mailto|tel):/)) return;
  if (_state.waitingUrls.includes(url) || _state.doneUrls.includes(url) || _state.inProgressUrls.includes(url)) return;

  const dir = '/' + url.split('/').slice(3).join('/');
  let matchIgnore = false;
  (_state.ignoreRegExps || []).forEach((regStr) => {
    try {
      const reg = new RegExp(regStr);
      if (dir.match(reg) || url.match(reg)) matchIgnore = true;
    } catch (e) {
      // ignore invalid regex
    }
  });
  if (matchIgnore) return;
  if (_isDisallowedByRobots(url)) return;

  if (_state.skipSimilar) {
    let isSimilar = false;
    (_state.similarCheckUrls || []).forEach((checkUrl) => {
      if (url.match(new RegExp(checkUrl))) isSimilar = true;
    });
    if (isSimilar) return;
    const checkUrl = decodeURIComponent(url)
      .split('/')
      .map((str) => {
        if (!str) return str;
        if (str.replace(/[0-9]+/g, '') === '') return '[0-9]+';
        if (str.match(/[ぁ-んァ-ン一-龥]/)) return '.+';
        return str.replace(/[0-9]+\..+/, '[0-9]+\\..+');
      })
      .join('/');
    if (checkUrl !== url && !_state.similarCheckUrls.includes(checkUrl)) _state.similarCheckUrls.push(checkUrl);
  }

  const domain = url.split('/')[2] || '';
  const rootDomain = (_state.rootUrl || '').split('/')[2] || '';
  let matchRoot = _state.includeSubDomain ? domain.includes(_state.baseDomain) : domain === rootDomain;
  if (!_state.isTargetAll && !url.includes(_state.rootUrl)) matchRoot = false;

  if (matchRoot) {
    _state.waitingUrls.push(url);
    _state.waitingUrls.sort((a, b) => (a.split('/').join('') < b.split('/').join('') ? -1 : 1));
  } else {
    const externalUrl = _getRootUrl(url);
    if (externalUrl && !_state.externalDomains.includes(externalUrl)) _state.externalDomains.push(externalUrl);
  }
};

const _resetRuntime = async () => {
  Object.assign(_state, {
    initialized: false,
    paused: false,
    automatedRun: false,
    srcTabId: null,
    rootUrl: null,
    baseDomain: null,
    waitingUrls: [],
    doneUrls: [],
    inProgressUrls: [],
    currentUrl: null,
    data: [],
    externalDomains: [],
    isPending: false,
    pendingCountIdx: {},
    similarCheckUrls: [],
    robotsDisallowPatterns: [],
  });
  await _setStorage();
};

const _loadSnapshots = async () => {
  const local = await _storageLocalGet(['crawlSnapshots']);
  let snapshots = local.crawlSnapshots || {};
  if (_state.useCloudSync) {
    const sync = await _storageSyncGet(['crawlSnapshots']);
    snapshots = {...snapshots, ...(sync.crawlSnapshots || {})};
  }
  return snapshots;
};

const _saveSnapshots = async (snapshots) => {
  await _storageLocalSet({crawlSnapshots: snapshots});
  if (_state.useCloudSync) await _storageSyncSet({crawlSnapshots: snapshots});
};

const _computeAnalytics = (data) => {
  const redirects = data.filter((item) => item.redirectSrcUrl).length;
  const notFound = data.filter((item) => item.info.notFound).length;
  const noindex = data.filter((item) => item.info.noindex).length;
  const nofollow = data.filter((item) => item.info.nofollow).length;
  const titleLens = data.map((item) => (item.info.title || '').length).filter(Boolean);
  const avgTitleLength = titleLens.length ? Math.round(titleLens.reduce((a, b) => a + b, 0) / titleLens.length) : 0;
  return {redirects, notFound, noindex, nofollow, avgTitleLength, total: data.length};
};

const _computeDiff = (rootUrl, data, previousSnapshot) => {
  const currentIdx = {};
  data.forEach((item) => {
    currentIdx[item.url] = item.info.title || '';
  });
  const previousIdx = (previousSnapshot && previousSnapshot.urls) || {};
  const added = Object.keys(currentIdx).filter((url) => !previousIdx[url]);
  const removed = Object.keys(previousIdx).filter((url) => !currentIdx[url]);
  const modified = Object.keys(currentIdx).filter((url) => previousIdx[url] && previousIdx[url] !== currentIdx[url]);
  return {
    rootUrl,
    added,
    removed,
    modified,
    counts: {added: added.length, removed: removed.length, modified: modified.length},
  };
};

const _dispatchNext = async () => {
  if (!_state.initialized || _state.paused || _state.isPending) return;

  if (_state.isAsync) {
    if (_state.inProgressUrls.length > 0) return;
    const nextUrl = _state.waitingUrls.splice(0, 1)[0];
    if (!nextUrl) {
      if (_state.inProgressUrls.length === 0) await _allComplete();
      return;
    }
    _state.currentUrl = nextUrl;
    _state.inProgressUrls.push(nextUrl);
    await _setStorage();
    const ok = await _tabsUpdate(_state.srcTabId, {url: nextUrl});
    if (!ok) {
      _state.inProgressUrls = _state.inProgressUrls.filter((url) => url !== nextUrl);
      _state.waitingUrls.unshift(nextUrl);
      _state.paused = true;
      await _setStorage();
    }
    return;
  }

  const limit = Math.max(1, Math.min(10, Number(_state.concurrency) || 1));
  while (_state.inProgressUrls.length < limit && _state.waitingUrls.length > 0) {
    const nextUrl = _state.waitingUrls.splice(0, 1)[0];
    _state.currentUrl = nextUrl;
    _state.inProgressUrls.push(nextUrl);
    const sent = await _sendTabMessage({
      type: 'fetch',
      url: nextUrl,
      progressStatus: _getProgressStatus(),
      requestOptions: {
        headers: _parseHeaderLines(_state.customHeaders),
        customCookies: _state.customCookies,
      },
    });
    if (!sent) {
      _state.inProgressUrls = _state.inProgressUrls.filter((url) => url !== nextUrl);
      _state.waitingUrls.push(nextUrl);
      break;
    }
    if (_state.isSlow) await new Promise((f) => setTimeout(f, 300));
  }

  await _setStorage();
  if (_state.waitingUrls.length === 0 && _state.inProgressUrls.length === 0) {
    await _allComplete();
  }
};

const _initParams = async (request) => {
  _state.initialized = true;
  _state.paused = false;
  _state.automatedRun = !!request.automatedRun;
  _state.srcTabId = request.srcTabId;
  _state.rootUrl = request.isTargetAll ? _getRootUrl(request.srcUrl) : _cleanUrl(request.srcUrl);
  _state.baseDomain = _getBaseDomain(_state.rootUrl);
  _state.waitingUrls = [_state.rootUrl];
  _state.doneUrls = [];
  _state.inProgressUrls = [];
  _state.currentUrl = null;
  _state.data = [];
  _state.externalDomains = [];
  _state.isAsync = !!request.isAsync;
  _state.isPending = false;
  _state.isQueryIgnore = request.isQueryIgnore !== false;
  _state.isTargetAll = !!request.isTargetAll;
  _state.ignoreRegExps = request.ignoreRegExps || [];
  _state.includeSubDomain = !!request.includeSubDomain;
  _state.pendingCountIdx = {};
  _state.skipSimilar = !!request.skipSimilar;
  _state.isSlow = !!request.isSlow;
  _state.similarCheckUrls = [];
  _state.concurrency = _state.isAsync ? 1 : Math.max(1, Math.min(10, Number(request.concurrency) || 1));
  _state.respectRobots = request.respectRobots !== false;
  _state.customHeaders = request.customHeaders || [];
  _state.customCookies = request.customCookies || '';
  _state.useCloudSync = !!request.useCloudSync;
  _state.projectNote = request.projectNote || _projectSettings.projectNote || '';

  await _loadRobots(_state.rootUrl);
  await _setStorage();
};

const _start = async (request) => {
  if (_state.initialized && ((_state.waitingUrls || []).length || (_state.inProgressUrls || []).length)) {
    return {ok: false, error: 'A crawl is already running. Pause/resume or wait for completion.'};
  }
  await _initParams(request);
  if (_state.automatedRun) _sendNotification('Crawl Sitemap Generator', `Scheduled crawl started: ${_state.rootUrl}`);
  await _dispatchNext();
  return {ok: true};
};

const _pause = async () => {
  _state.paused = true;
  await _setStorage();
  return {ok: true, status: _buildStatus()};
};

const _resume = async () => {
  if (!_state.initialized) return {ok: false, error: 'No crawl to resume'};
  _state.paused = false;
  await _setStorage();
  await _dispatchNext();
  return {ok: true, status: _buildStatus()};
};

const _push = async (request) => {
  let {info, links, realUrl, requestedUrl} = request;
  links = links || [];
  requestedUrl = _cleanUrl(requestedUrl || realUrl || _state.currentUrl || '');
  realUrl = _cleanUrl(realUrl || requestedUrl);

  _state.inProgressUrls = _state.inProgressUrls.filter((url) => url !== requestedUrl && url !== realUrl);
  if (!_state.doneUrls.includes(requestedUrl)) _state.doneUrls.push(requestedUrl);
  if (!_state.doneUrls.includes(realUrl)) _state.doneUrls.push(realUrl);

  const redirectSrcUrl = requestedUrl && requestedUrl !== realUrl ? requestedUrl : '';
  _state.data.push({url: realUrl, redirectSrcUrl, info: info || {notFound: true}});

  links.forEach(_enqueueUrl);

  await _setStorage();
  await _dispatchNext();
};

const _allComplete = async () => {
  const snapshots = await _loadSnapshots();
  const previousSnapshot = snapshots[_state.rootUrl];
  const diff = _computeDiff(_state.rootUrl, _state.data, previousSnapshot);
  const analytics = _computeAnalytics(_state.data);

  snapshots[_state.rootUrl] = {
    updatedAt: new Date().toISOString(),
    urls: _state.data.reduce((acc, item) => {
      acc[item.url] = item.info.title || '';
      return acc;
    }, {}),
  };
  await _saveSnapshots(snapshots);

  await _sendTabMessage({
    type: 'all_complete',
    rootUrl: _state.rootUrl,
    data: _state.data,
    externalDomains: _state.externalDomains,
    skipSimilar: _state.skipSimilar,
    isSlow: _state.isSlow,
    similarCheckUrls: _state.similarCheckUrls,
    analytics,
    diff,
    projectNote: _state.projectNote,
  });

  if (_state.automatedRun) {
    _sendNotification('Crawl Sitemap Generator', `Scheduled crawl completed: ${_state.rootUrl} (${analytics.total} pages)`);
  }

  await _resetRuntime();
};

const _saveProjectSettings = async (projectSettings = {}) => {
  _projectSettings = {..._projectSettings, ...projectSettings};
  await _storageLocalSet({projectSettings: _projectSettings});
  if (_projectSettings.useCloudSync) await _storageSyncSet({projectSettings: _projectSettings});
  return _projectSettings;
};

const _loadProjectSettings = async () => {
  const local = await _storageLocalGet(['projectSettings']);
  if (local.projectSettings) _projectSettings = {..._projectSettings, ...local.projectSettings};
  if (_projectSettings.useCloudSync) {
    const sync = await _storageSyncGet(['projectSettings']);
    if (sync.projectSettings) _projectSettings = {..._projectSettings, ...sync.projectSettings};
  }
  return _projectSettings;
};

const _frequencyToMinutes = (frequency) => {
  if (frequency === 'weekly') return 60 * 24 * 7;
  if (frequency === 'monthly') return 60 * 24 * 30;
  return 60 * 24;
};

const _saveSchedules = async () => {
  await _storageLocalSet({schedules: _schedules});
  if (_projectSettings.useCloudSync) await _storageSyncSet({schedules: _schedules});
};

const _syncAlarms = async () => {
  const existing = await new Promise((resolve) => chrome.alarms.getAll(resolve));
  await Promise.all((existing || []).filter((alarm) => alarm.name.startsWith('crawl_schedule_')).map((alarm) => _clearAlarm(alarm.name)));

  _schedules.forEach((schedule) => {
    chrome.alarms.create(`crawl_schedule_${schedule.id}`, {
      periodInMinutes: _frequencyToMinutes(schedule.frequency),
    });
  });
};

const _loadSchedules = async () => {
  const local = await _storageLocalGet(['schedules']);
  _schedules = local.schedules || [];
  if (_projectSettings.useCloudSync) {
    const sync = await _storageSyncGet(['schedules']);
    if (sync.schedules && sync.schedules.length) _schedules = sync.schedules;
  }
  await _syncAlarms();
  return _schedules;
};

const _addSchedule = async (schedule) => {
  const id = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  _schedules.push({id, ...schedule});
  await _saveSchedules();
  await _syncAlarms();
  return _schedules;
};

const _removeSchedule = async (id) => {
  _schedules = _schedules.filter((item) => item.id !== id);
  await _saveSchedules();
  await _syncAlarms();
  return _schedules;
};

const _runSchedule = async (scheduleId) => {
  const schedule = _schedules.find((item) => item.id === scheduleId);
  if (!schedule) return;
  if (_state.initialized) {
    _sendNotification('Crawl Sitemap Generator', 'Scheduled crawl skipped because another crawl is running.');
    return;
  }

  const tab = await _tabsCreate({url: schedule.url, active: false});
  if (!tab) {
    _sendNotification('Crawl Sitemap Generator', `Failed to open tab for scheduled crawl: ${schedule.url}`);
    return;
  }

  const config = schedule.config || {};
  await _start({
    type: 'start',
    srcUrl: schedule.url,
    srcTabId: tab.id,
    automatedRun: true,
    isAsync: true,
    isQueryIgnore: config.isQueryIgnore !== false,
    isTargetAll: config.isTargetAll !== false,
    ignoreRegExps: config.ignoreRegExps || [],
    includeSubDomain: !!config.includeSubDomain,
    skipSimilar: !!config.skipSimilar,
    isSlow: !!config.isSlow,
    concurrency: config.concurrency || _projectSettings.concurrency || 3,
    respectRobots: config.respectRobots !== false,
    customHeaders: config.customHeaders || _projectSettings.customHeaders || [],
    customCookies: config.customCookies || _projectSettings.customCookies || '',
    useCloudSync: config.useCloudSync || _projectSettings.useCloudSync || false,
    projectNote: config.projectNote || _projectSettings.projectNote || '',
  });
};

chrome.runtime.onInstalled.addListener(async () => {
  await _restoreStateIfNeeded();
  await _loadProjectSettings();
  await _loadSchedules();
});
chrome.runtime.onStartup.addListener(async () => {
  await _restoreStateIfNeeded();
  await _loadProjectSettings();
  await _loadSchedules();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('crawl_schedule_')) return;
  const scheduleId = alarm.name.replace('crawl_schedule_', '');
  await _restoreStateIfNeeded();
  await _loadProjectSettings();
  await _loadSchedules();
  await _runSchedule(scheduleId);
});

chrome.runtime.onMessage.addListener((request, sender, callback) => {
  const run = async () => {
    await _restoreStateIfNeeded();

    switch (request.type) {
      case 'content_ready': {
        const tab = sender.tab || {};
        const isActiveTab = tab.id === _state.srcTabId;
        callback({
          needSendHtml: isActiveTab,
          isAsync: _state.isAsync,
          progressStatus: _getProgressStatus(),
          requestOptions: {
            headers: _parseHeaderLines(_state.customHeaders),
            customCookies: _state.customCookies,
          },
        });

        if (_state.isPending && isActiveTab && !_state.paused) {
          _state.isPending = false;
          await _setStorage();
          await _dispatchNext();
        }
        break;
      }

      case 'start': {
        const res = await _start(request);
        callback(res);
        break;
      }

      case 'pause': {
        callback(await _pause());
        break;
      }

      case 'resume': {
        callback(await _resume());
        break;
      }

      case 'fetch_pending': {
        const retryUrl = _cleanUrl(request.url || _state.currentUrl || '');
        if (!_state.pendingCountIdx[retryUrl]) _state.pendingCountIdx[retryUrl] = 0;
        _state.pendingCountIdx[retryUrl]++;
        if (_state.pendingCountIdx[retryUrl] >= 3) {
          const retryDomain = retryUrl.split('/')[2] || '';
          _state.waitingUrls = _state.waitingUrls.filter((url) => !url.includes(retryDomain));
          _state.inProgressUrls = _state.inProgressUrls.filter((url) => url !== retryUrl);
          await _setStorage();
          await _dispatchNext();
          return;
        }

        _state.isPending = true;
        _state.inProgressUrls = _state.inProgressUrls.filter((url) => url !== retryUrl);
        if (retryUrl && !_state.waitingUrls.includes(retryUrl)) _state.waitingUrls.unshift(retryUrl);
        await _setStorage();
        callback({ok: true});
        break;
      }

      case 'push': {
        await _push(request);
        callback({ok: true});
        break;
      }

      case 'popup_bootstrap': {
        await _loadProjectSettings();
        await _loadSchedules();
        callback({status: _buildStatus(), schedules: _schedules, projectSettings: _projectSettings});
        break;
      }

      case 'save_project_settings': {
        const projectSettings = await _saveProjectSettings(request.projectSettings || {});
        callback({ok: true, projectSettings});
        break;
      }

      case 'add_schedule': {
        if (!request.schedule || !request.schedule.url) {
          callback({ok: false, error: 'Missing schedule url'});
          break;
        }
        const schedules = await _addSchedule(request.schedule);
        callback({ok: true, schedules});
        break;
      }

      case 'remove_schedule': {
        const schedules = await _removeSchedule(request.id);
        callback({ok: true, schedules});
        break;
      }

      default:
        callback({ok: true});
        break;
    }
  };

  run().catch((e) => {
    callback({ok: false, error: e && e.message ? e.message : String(e)});
  });

  return true;
});
