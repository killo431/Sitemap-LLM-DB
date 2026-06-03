let _scrollTimeout = false;
let _statusEl;
let _requestOptions = {headers: {}, customCookies: ''};

const _qs = (expr) => Array.prototype.slice.call(document.querySelectorAll(expr));
const _range = (num) => Array.from({length: num}, (_, i) => i);

const _domReady = () => {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((f) => document.addEventListener('DOMContentLoaded', f));
};

Promise.race([
  new Promise((f) => setTimeout(f, 5000)),
  _domReady().then(() => new Promise((f) => setTimeout(f, 100))),
]).then(() => {
  chrome.runtime.sendMessage({type: 'content_ready', url: location.href}, (res) => {
    res = res || {};
    const {needSendHtml, isAsync, progressStatus, requestOptions} = res;
    _requestOptions = requestOptions || _requestOptions;

    if (needSendHtml && isAsync) {
      _updateProgressStatus(progressStatus);
      Promise.race([
        new Promise((f) => setTimeout(f, 1000)),
        new Promise((f) => window.addEventListener('load', f)),
      ]).then(() => _scrollDown());

      setTimeout(() => {
        _scrollTimeout = true;
        _sendHtml(_getHtml(), location.href, location.href);
      }, 15 * 1000);
    }
  });
});

const _scrollTarget = document.scrollingElement || document.documentElement;
const _scrollDown = () => {
  const oldTop = _scrollTarget.scrollTop;
  _scrollTarget.scrollTop = oldTop + 2000;
  setTimeout(() => {
    const scrollableMore = document.body.offsetHeight > (_scrollTarget.scrollTop + window.innerHeight);
    if (oldTop === _scrollTarget.scrollTop && !scrollableMore) {
      if (_scrollTimeout) return;
      _sendHtml(_getHtml(), location.href, location.href);
    } else {
      _scrollDown();
    }
  }, 500);
};

const _getHtml = () => {
  const html = document.getElementsByTagName('html')[0];
  return `<html>${html.innerHTML}</html>`;
};

const _buildFetchHeaders = (requestOptions = {}) => {
  const headers = {...(requestOptions.headers || {})};
  if (requestOptions.customCookies) headers.Cookie = requestOptions.customCookies;
  return headers;
};

const _fetchHtml = (url, progressStatus, requestOptions = _requestOptions) => {
  const currentHref = location.href.split('?')[0].split('#')[0];
  if (url === currentHref) {
    _sendHtml(_getHtml(), url, url);
    return Promise.resolve();
  }

  const newDomain = url.split('/').slice(0, 3).join('/');
  const currentDomain = location.href.split('/').slice(0, 3).join('/');
  if (newDomain !== currentDomain) {
    chrome.runtime.sendMessage({type: 'fetch_pending', url}, () => {
      location.href = url;
    });
    return;
  }

  _updateProgressStatus(progressStatus);

  if (url.toLowerCase().includes('/logout/')) {
    _sendHtml('<html><head><title>logout</title></head><body></body></html>', url, url);
    return;
  }

  fetch(url, {
    credentials: 'same-origin',
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
    headers: _buildFetchHeaders(requestOptions),
  })
    .then((res) => {
      if (!res.ok) throw Error(res.statusText);
      const res2 = res.clone();
      return new Promise((f) => {
        res.text().then((text) => {
          let irregularEncoding = '';
          const t = text.toLowerCase();
          if (t.includes('charset=shift_jis')) irregularEncoding = 'shift-jis';
          if (t.includes('charset=windows-31j')) irregularEncoding = 'Windows-31J';

          if (!irregularEncoding) return f(text);
          res2.arrayBuffer().then((arrayBuffer) => {
            const html = new TextDecoder(irregularEncoding).decode(arrayBuffer);
            f(html);
          });
        });
      });
    })
    .then((html) => _sendHtml(html, url, url))
    .catch(() => _sendHtml('', url, url));
};

const _sendHtml = (html, realUrl, requestedUrl) => {
  chrome.runtime.sendMessage({
    type: 'push',
    info: _html2info(html),
    links: _html2links(html),
    realUrl,
    requestedUrl,
  }, () => {});
};

const _html2info = (html) => {
  const title = (html.split('<title>')[1] || '').split('</title>')[0] || '';
  let _description = '';
  let _ogImage = '';
  let _robots = '';

  html.split('<meta ').slice(1).forEach((line) => {
    const attrs = line.split('>')[0] || '';
    if (attrs.includes('name="description"')) _description = (attrs.match(/content="(.*?)"/) || [])[1] || '';
    if (attrs.includes('property="og:image"')) _ogImage = (attrs.match(/content="(.*?)"/) || [])[1] || '';
    if (attrs.includes('name="robots"')) _robots = (attrs.match(/content="(.*?)"/) || [])[1] || '';
  });

  const robots = (_robots || '').toLowerCase();

  return {
    notFound: !html,
    title,
    description: _description,
    ogImage: _ogImage,
    noindex: robots.includes('noindex'),
    nofollow: robots.includes('nofollow'),
  };
};

const _a = document.createElement('a');
const _html2links = (html) => {
  const links = [];
  html.split('<a ').slice(1).forEach((line) => {
    const attrs = line.split('>')[0] || '';
    const href = (attrs.match(/href="(.*?)"/) || [])[1];
    if (!href) return;
    if (href.toLowerCase().match(/\.(jpeg|jpg|png|gif|svg|zip|pdf|mp4|mp3|woff|woff2)$/)) return;
    _a.href = href;
    const url = _a.href;
    if (!links.includes(url)) links.push(url);
  });
  return links;
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

  _statusEl.innerHTML = '<div class="crawlerStatus_inner"><div class="crawlerStatus_msg"></div></div>';
};

const _updateProgressStatus = (progressStatus) => {
  _makeStatusEl();
  if (!progressStatus) return;

  const waiting = (progressStatus.waitingCount || 0) + (progressStatus.inProgressCount || 0);
  const done = progressStatus.doneCount || 0;
  _statusEl.querySelector('.crawlerStatus_msg').innerHTML = `
Crawling...<br>
<br>
Done: ${done}<br>
Waiting: ${waiting}<br>
Total seen: ${done + waiting}<br>
  `;
};

const _escapeXml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const _downloadText = (content, filename, mimeType = 'text/plain') => {
  const blob = new Blob([content], {type: mimeType});
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
};

const _buildTree = (sortedData, rootUrl) => {
  const root = {name: rootUrl, children: {}};
  sortedData.forEach((item) => {
    const url = item.url;
    const path = '/' + url.split('/').slice(3).join('/');
    const parts = path.split('/').filter(Boolean);
    let node = root;
    if (!parts.length) {
      node.children['/'] = node.children['/'] || {name: '/', url, children: {}};
      return;
    }
    parts.forEach((part, index) => {
      if (!node.children[part]) {
        const subPath = parts.slice(0, index + 1).join('/');
        node.children[part] = {
          name: part,
          url: `${rootUrl}${subPath}${index === parts.length - 1 && !url.endsWith('/') ? '' : '/'}`,
          children: {},
        };
      }
      node = node.children[part];
    });
  });
  return root;
};

const _treeToHtml = (node) => {
  const entries = Object.values(node.children || {});
  if (!entries.length) return '';
  const items = entries.map((child) => {
    const childrenHtml = _treeToHtml(child);
    return `<li><details open><summary><a href="${child.url}" target="_blank">${child.name}</a></summary>${childrenHtml || ''}</details></li>`;
  }).join('');
  return `<ul>${items}</ul>`;
};

const _allComplete = (msg) => {
  _makeStatusEl();
  const {rootUrl, data, externalDomains, similarCheckUrls, skipSimilar, analytics, diff, projectNote} = msg;

  const sortedData = (data || []).slice().sort((a, b) => (a.url < b.url ? -1 : 1));
  const notFoundUrls = sortedData.filter((item) => item.info.notFound).map((item) => item.url);
  const notFoundCount = notFoundUrls.length;
  const okCount = sortedData.length - notFoundCount;

  const formatSitemapTable = () => {
    const head = ['url', 'title', 'description', 'og:image', 'noindex', 'nofollow', 'redirect_src_url'];
    if (skipSimilar) head.push('similar_url');

    const rows = sortedData
      .filter((item) => !item.info.notFound)
      .map((item) => {
        let hasSimilarUrl = false;
        (similarCheckUrls || []).forEach((checkUrl) => {
          try {
            if (item.url.match(new RegExp(checkUrl))) hasSimilarUrl = true;
          } catch (e) {
            // ignore invalid regex
          }
        });
        const cols = [
          item.url,
          (item.info.title || '').replace(/\s+/g, ' ').trim(),
          (item.info.description || '').replace(/\s+/g, ' ').trim(),
          item.info.ogImage || '',
          item.info.noindex ? 'yes' : 'no',
          item.info.nofollow ? 'yes' : 'no',
          item.redirectSrcUrl || '',
        ];
        if (skipSimilar) cols.push(hasSimilarUrl ? 'yes' : 'no');
        return cols.join('\t');
      });

    return `${head.join('\t')}\n${rows.join('\n')}`;
  };

  const toJson = () => JSON.stringify({rootUrl, projectNote, pages: sortedData, analytics, diff}, null, 2);

  const toCsv = () => {
    const head = ['url', 'title', 'description', 'ogImage', 'notFound', 'noindex', 'nofollow', 'redirectSrcUrl'];
    const rows = sortedData.map((item) => {
      const cells = [
        item.url,
        item.info.title || '',
        item.info.description || '',
        item.info.ogImage || '',
        item.info.notFound ? 'true' : 'false',
        item.info.noindex ? 'true' : 'false',
        item.info.nofollow ? 'true' : 'false',
        item.redirectSrcUrl || '',
      ];
      return cells.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    return `${head.join(',')}\n${rows.join('\n')}`;
  };

  const toXmlChunks = () => {
    const currentDate = new Date().toISOString().split('T')[0];
    const urls = sortedData.filter((item) => !item.info.notFound).map((item) => item.url);
    const chunkSize = 50000;
    const chunks = [];

    for (let i = 0; i < urls.length; i += chunkSize) {
      const partUrls = urls.slice(i, i + chunkSize);
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
      partUrls.forEach((url) => {
        xml += `  <url>\n    <loc>${_escapeXml(url)}</loc>\n    <lastmod>${currentDate}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.5</priority>\n  </url>\n`;
      });
      xml += '</urlset>';
      chunks.push(xml);
    }

    let indexXml = '';
    if (chunks.length > 1) {
      indexXml = '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
      chunks.forEach((_, i) => {
        indexXml += `  <sitemap>\n    <loc>${_escapeXml(rootUrl)}sitemap-part-${i + 1}.xml</loc>\n    <lastmod>${currentDate}</lastmod>\n  </sitemap>\n`;
      });
      indexXml += '</sitemapindex>';
    }

    return {chunks, indexXml};
  };

  const tree = _buildTree(sortedData, rootUrl);
  const treeHtml = _treeToHtml(tree);
  const htmlReport = `<!doctype html><html><head><meta charset="utf-8"><title>Sitemap Visual Report</title><style>body{font-family:sans-serif;padding:20px}ul{padding-left:20px}summary{cursor:pointer}</style></head><body><h1>Sitemap Visual Report</h1><p>${rootUrl}</p>${treeHtml}</body></html>`;

  _statusEl.innerHTML = `
<div class="crawlerStatus_inner">
  <div class="crawlerStatus_msg">
    Crawl has been completed!<br><br>
    total: ${sortedData.length}<br>
    (ok: ${okCount} / not_found: ${notFoundCount})<br><br>
    Project note: ${(projectNote || '-').replace(/</g, '&lt;')}<br>
  </div>
  <div class="crawlerStatus_result">
    <section class="crawlerStatus_resultSection">
      <h2 class="crawlerStatus_resultHead">Exports</h2>
      <button data-export="xml">Download XML Sitemap</button>
      <button data-export="json">Download JSON</button>
      <button data-export="csv">Download CSV</button>
      <button data-export="html">Download Visual HTML</button>
    </section>
    <section class="crawlerStatus_resultSection">
      <h2 class="crawlerStatus_resultHead">Analytics</h2>
      <textarea class="crawlerStatus_resultText" name="analytics"></textarea>
    </section>
    <section class="crawlerStatus_resultSection">
      <h2 class="crawlerStatus_resultHead">Diff (vs previous crawl)</h2>
      <textarea class="crawlerStatus_resultText" name="diff"></textarea>
    </section>
    <section class="crawlerStatus_resultSection">
      <h2 class="crawlerStatus_resultHead">Visual Sitemap Tree</h2>
      <textarea class="crawlerStatus_resultText" name="tree"></textarea>
    </section>
    <section class="crawlerStatus_resultSection">
      <h2 class="crawlerStatus_resultHead">Sitemap (Copy to Spreadsheet/Excel)</h2>
      <textarea class="crawlerStatus_resultText" name="sitemap" onfocus="this.select();"></textarea>
    </section>
    <section class="crawlerStatus_resultSection">
      <h2 class="crawlerStatus_resultHead">External Domains List</h2>
      <textarea class="crawlerStatus_resultText" name="externals"></textarea>
    </section>
    <section class="crawlerStatus_resultSection">
      <h2 class="crawlerStatus_resultHead">Broken Links (404, not found)</h2>
      <textarea class="crawlerStatus_resultText" name="notfound"></textarea>
    </section>
  </div>
</div>`;

  const siteName = rootUrl.replace(/\/$/, '').split('//')[1].replace(/\./g, '-');

  _qs('.crawlerStatus_resultText[name="sitemap"]')[0].value = formatSitemapTable();
  _qs('.crawlerStatus_resultText[name="externals"]')[0].value = (externalDomains || []).slice().sort((a, b) => (a < b ? -1 : 1)).join('\n');
  _qs('.crawlerStatus_resultText[name="notfound"]')[0].value = notFoundUrls.slice().sort((a, b) => (a < b ? -1 : 1)).join('\n');
  _qs('.crawlerStatus_resultText[name="analytics"]')[0].value = JSON.stringify(analytics || {}, null, 2);
  _qs('.crawlerStatus_resultText[name="diff"]')[0].value = JSON.stringify(diff || {}, null, 2);
  _qs('.crawlerStatus_resultText[name="tree"]')[0].value = treeHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  _qs('button[data-export]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-export');
      if (type === 'json') {
        _downloadText(toJson(), `${siteName}-sitemap.json`, 'application/json');
        return;
      }
      if (type === 'csv') {
        _downloadText(toCsv(), `${siteName}-sitemap.csv`, 'text/csv');
        return;
      }
      if (type === 'html') {
        _downloadText(htmlReport, `${siteName}-sitemap-visual.html`, 'text/html');
        return;
      }

      const {chunks, indexXml} = toXmlChunks();
      chunks.forEach((chunk, i) => {
        const suffix = chunks.length > 1 ? `-part-${i + 1}` : '';
        _downloadText(chunk, `${siteName}-sitemap${suffix}.xml`, 'application/xml');
      });
      if (indexXml) _downloadText(indexXml, `${siteName}-sitemap-index.xml`, 'application/xml');
    });
  });

  setTimeout(() => {
    alert('Crawl has been completed!');
  }, 33);
};

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'fetch':
      _fetchHtml(msg.url, msg.progressStatus, msg.requestOptions || _requestOptions);
      break;
    case 'all_complete':
      _allComplete(msg);
      break;
  }
  return true;
});
