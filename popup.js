const qs = (expr) => Array.prototype.slice.call(document.querySelectorAll(expr));

const getRadioValue = (name) => {
  let res = '';
  qs(`[name="${name}"]`).forEach((radio) => {
    if (radio.checked) res = radio.value;
  });
  return res;
};

const formatEOL = (str = '') => str.split('\r\n').join('\n').split('\r').join('\n');

const parseLines = (str = '') => formatEOL(str).split('\n').map((line) => line.trim()).filter(Boolean);

const statusLine = document.getElementById('statusLine');
const setStatus = (msg) => {
  statusLine.textContent = msg;
};

const optionEl = qs('.option')[0];
let _optionOpened = false;
qs('.optionToggleButton')[0].addEventListener('click', () => {
  _optionOpened = !_optionOpened;
  optionEl.classList[_optionOpened ? 'add' : 'remove']('is_opened');
});

const getCommonConfig = () => {
  const isAsync = getRadioValue('async') === 'yes';
  return {
    isAsync,
    isQueryIgnore: getRadioValue('queryIgnore') === 'yes',
    isTargetAll: getRadioValue('targetAll') === 'yes',
    includeSubDomain: getRadioValue('includeSubDomain') === 'yes',
    skipSimilar: getRadioValue('skipSimilar') === 'yes',
    isSlow: getRadioValue('slow') === 'yes',
    ignoreRegExps: parseLines(qs('textarea[name="ignoreDir"]')[0].value),
    concurrency: Number(document.getElementById('concurrencyInput').value || 1),
    respectRobots: document.getElementById('respectRobots').checked,
    customHeaders: parseLines(document.getElementById('customHeaders').value),
    customCookies: document.getElementById('customCookies').value.trim(),
    useCloudSync: document.getElementById('useCloudSync').checked,
    projectNote: document.getElementById('projectNote').value.trim(),
  };
};

const startButton = document.getElementById('startButton');
const pauseButton = document.getElementById('pauseButton');
const resumeButton = document.getElementById('resumeButton');
const addScheduleButton = document.getElementById('addScheduleButton');
const scheduleListEl = document.getElementById('scheduleList');

startButton.focus();

const renderSchedules = (schedules = []) => {
  scheduleListEl.innerHTML = '';
  schedules.forEach((item) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${item.url} (${item.frequency})</span>
      <button data-id="${item.id}" type="button">Remove</button>
    `;
    li.querySelector('button').addEventListener('click', () => {
      chrome.runtime.sendMessage({type: 'remove_schedule', id: item.id}, (res) => {
        renderSchedules((res || {}).schedules || []);
      });
    });
    scheduleListEl.appendChild(li);
  });
};

const loadPopupState = () => {
  chrome.runtime.sendMessage({type: 'popup_bootstrap'}, (res) => {
    const {status, schedules, projectSettings} = res || {};
    if (status) {
      setStatus(status.initialized ? `Crawl status: ${status.paused ? 'Paused' : 'Running'} | done ${status.doneCount} / waiting ${status.waitingCount}` : 'Crawl status: Idle');
    }
    if (projectSettings) {
      document.getElementById('customHeaders').value = (projectSettings.customHeaders || []).join('\n');
      document.getElementById('customCookies').value = projectSettings.customCookies || '';
      document.getElementById('concurrencyInput').value = projectSettings.concurrency || 3;
      document.getElementById('respectRobots').checked = projectSettings.respectRobots !== false;
      document.getElementById('useCloudSync').checked = !!projectSettings.useCloudSync;
      document.getElementById('projectNote').value = projectSettings.projectNote || '';
    }
    renderSchedules(schedules || []);
  });
};

startButton.addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) return;
    const msg = {
      type: 'start',
      srcUrl: tab.url,
      srcTabId: tab.id,
      ...getCommonConfig(),
    };
    chrome.runtime.sendMessage(msg, (response) => {
      const ok = response && response.ok;
      setStatus(ok ? 'Crawl started.' : `Start rejected: ${(response && response.error) || 'unknown error'}`);
      chrome.runtime.sendMessage({type: 'save_project_settings', projectSettings: getCommonConfig()}, () => {});
    });
  });
});

pauseButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({type: 'pause'}, (res) => {
    setStatus((res && res.ok) ? 'Crawl paused.' : 'Pause failed.');
    loadPopupState();
  });
});

resumeButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({type: 'resume'}, (res) => {
    setStatus((res && res.ok) ? 'Crawl resumed.' : `Resume failed: ${(res && res.error) || ''}`);
    loadPopupState();
  });
});

addScheduleButton.addEventListener('click', () => {
  const url = document.getElementById('scheduleUrl').value.trim();
  const frequency = document.getElementById('scheduleFrequency').value;
  if (!url) {
    setStatus('Schedule URL is required.');
    return;
  }
  const config = getCommonConfig();
  chrome.runtime.sendMessage({type: 'add_schedule', schedule: {url, frequency, config}}, (res) => {
    if (res && res.ok) {
      document.getElementById('scheduleUrl').value = '';
      setStatus('Schedule added.');
      renderSchedules(res.schedules || []);
    } else {
      setStatus(`Add schedule failed: ${(res && res.error) || ''}`);
    }
  });
});

['customHeaders', 'customCookies', 'concurrencyInput', 'respectRobots', 'useCloudSync', 'projectNote'].forEach((id) => {
  const el = document.getElementById(id);
  const eventName = (el && el.type === 'checkbox') ? 'change' : 'blur';
  el.addEventListener(eventName, () => {
    chrome.runtime.sendMessage({type: 'save_project_settings', projectSettings: getCommonConfig()}, () => {});
  });
});

loadPopupState();
