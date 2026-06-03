const qs = (expr) => {
  return Array.prototype.slice.call(document.querySelectorAll(expr));
};

const getRadioValue = (name) => {
  let res = '';
  qs(`[name="${name}"]`).forEach((radio) => {
    if (radio.checked) res = radio.value;
  });
  return res;
};

const formatEOL = (str = '') => {
  return str
    .split('\r\n').join('\n')
    .split('\r').join('\n');
}


//option
const optionEl = qs('.option')[0];
let _optionOpened = false;
qs('.optionToggleButton')[0].addEventListener('click', () => {
  _optionOpened = !_optionOpened;
  optionEl.classList[_optionOpened ? 'add' : 'remove']('is_opened');
});


//start
const startButton = document.getElementById('startButton');
startButton.focus();
startButton.addEventListener('click', () => {


  const isAsync = getRadioValue('async') === 'yes';
  const isQueryIgnore = getRadioValue('queryIgnore') === 'yes';
  const isTargetAll = getRadioValue('targetAll') === 'yes';
  const includeSubDomain = getRadioValue('includeSubDomain') === 'yes';
  const skipSimilar = getRadioValue('skipSimilar') === 'yes';
  const isSlow = getRadioValue('slow') === 'yes';

  const ignoreRegExps = [];
  formatEOL(qs('textarea[name="ignoreDir"]')[0].value).split('\n').forEach((str) => {
    str = str.trim();
    if (!str) return;
    ignoreRegExps.push(str);
  });

  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const msg = {
      type            : 'start',
      srcUrl          : tabs[0].url,
      srcTabId        : tabs[0].id,
      isAsync         : isAsync,
      isQueryIgnore   : isQueryIgnore,
      isTargetAll     : isTargetAll,
      ignoreRegExps   : ignoreRegExps,
      includeSubDomain: includeSubDomain,
      skipSimilar     : skipSimilar,
      isSlow          : isSlow,
    };
    console.info('msg', msg);
    chrome.runtime.sendMessage(msg, (response) => {
        console.log(response)
      }
    );
  });
});
