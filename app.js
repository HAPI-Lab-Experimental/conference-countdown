/* Conference Countdown — vanilla JS, no build step.
 * Data comes from conferences.json; when that cannot be fetched (file://)
 * the inline copy in <script id="fallback-data"> is used instead.
 */
(function () {
  'use strict';

  var DATA_URL = 'conferences.json';
  var SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

  var params = new URLSearchParams(location.search);
  var focusId = params.get('conf');
  var focusEvent = params.has('event') ? parseInt(params.get('event'), 10) : null;
  if (!Number.isInteger(focusEvent)) focusEvent = null;

  var root = document.getElementById('app');
  var nowLocalNode = document.getElementById('now-local');
  var nowAoeNode = document.getElementById('now-aoe');
  var baseTitle = document.title;

  var conferences = [];
  var tickers = [];
  var lastSignature = null;
  var lastTitle = null;

  /* ---------- data ---------- */

  function readInline() {
    var inline = document.getElementById('fallback-data');
    if (!inline) throw new Error('No inline fallback data');
    return JSON.parse(inline.textContent);
  }

  function loadData() {
    if (location.protocol === 'file:') {
      return Promise.resolve(readInline());
    }
    return fetch(DATA_URL, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .catch(function (err) {
        console.info('conferences.json could not be fetched (' + err.message + '); using inline copy.');
        return readInline();
      });
  }

  var OFFSET_RE = /(Z|[+-]\d{2}:\d{2})$/;

  function parseOffset(iso) {
    var m = OFFSET_RE.exec(iso);
    if (!m) return { minutes: 0, label: 'UTC' };
    if (m[1] === 'Z') return { minutes: 0, label: 'UTC' };
    var sign = m[1].charAt(0) === '-' ? -1 : 1;
    var parts = m[1].slice(1).split(':');
    var minutes = sign * (Number(parts[0]) * 60 + Number(parts[1]));
    return { minutes: minutes, label: minutes === -720 ? 'AoE' : 'UTC' + m[1] };
  }

  function prepare(raw) {
    return raw.map(function (c) {
      var events = (c.events || []).map(function (e, i) {
        return {
          index: i,
          label: e.label,
          kind: e.kind,
          start: e.start,
          end: e.end || null,
          startMs: new Date(e.start).getTime(),
          endMs: e.end ? new Date(e.end).getTime() : null,
          offset: parseOffset(e.start)
        };
      });
      return { id: c.id, name: c.name, url: c.url, location: c.location, note: c.note, events: events };
    });
  }

  /* ---------- state ---------- */

  function eventStatus(ev, now) {
    var finish = ev.endMs || ev.startMs;
    if (finish <= now) return 'past';
    if (ev.startMs <= now) return 'live';
    return 'upcoming';
  }

  function conferenceState(conf, now) {
    if (!conf.events.length) return { status: 'tba', sortKey: Infinity, next: null, events: [] };
    var events = conf.events.map(function (ev) { return { ev: ev, status: eventStatus(ev, now) }; });
    var live = null, upcoming = [], confEnded = false, endedMs = -Infinity;
    events.forEach(function (x) {
      if (x.status === 'live' && !live) live = x.ev;
      if (x.status === 'upcoming') upcoming.push(x.ev);
      if (x.status === 'past') {
        endedMs = Math.max(endedMs, x.ev.endMs || x.ev.startMs);
        if (x.ev.kind === 'conference') confEnded = true;
      }
    });
    upcoming.sort(function (a, b) { return a.startMs - b.startMs; });
    if (confEnded || (!live && !upcoming.length)) {
      return { status: 'past', sortKey: -Infinity, next: null, events: events, endedMs: endedMs };
    }
    var next = live || upcoming[0];
    return { status: 'active', sortKey: live ? -Infinity : next.startMs, next: next, events: events };
  }

  function signature(confs, now) {
    return confs.map(function (c) {
      return c.events.map(function (e) { return eventStatus(e, now).charAt(0); }).join('');
    }).join('|');
  }

  /* ---------- formatting ---------- */

  function fmt(opts, tz) {
    if (tz) opts.timeZone = tz;
    return new Intl.DateTimeFormat('en-US', opts);
  }
  var utcDate = fmt({ month: 'short', day: 'numeric', year: 'numeric' }, 'UTC');
  var utcTime = fmt({ hour: 'numeric', minute: '2-digit' }, 'UTC');
  var localDate = fmt({ month: 'short', day: 'numeric', year: 'numeric' });
  var localTime = fmt({ hour: 'numeric', minute: '2-digit' });
  var localClock = fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  var utcClock = fmt({ hour: '2-digit', minute: '2-digit', hour12: false }, 'UTC');
  var localTzName = (function () {
    try {
      var parts = fmt({ timeZoneName: 'short' }).formatToParts(new Date());
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'timeZoneName') return parts[i].value;
    } catch (e) { /* ignore */ }
    return 'local';
  })();

  function shifted(ms, offset) { return new Date(ms + offset.minutes * MINUTE); }

  function part(parts, type) {
    for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
    return '';
  }

  function formatRange(a, b, dateFmt) {
    var pa = dateFmt.formatToParts(a), pb = dateFmt.formatToParts(b);
    if (part(pa, 'year') === part(pb, 'year')) {
      if (part(pa, 'month') === part(pb, 'month')) {
        return part(pa, 'month') + ' ' + part(pa, 'day') + '–' + part(pb, 'day') + ', ' + part(pa, 'year');
      }
      return part(pa, 'month') + ' ' + part(pa, 'day') + ' – ' + part(pb, 'month') + ' ' + part(pb, 'day') + ', ' + part(pa, 'year');
    }
    return dateFmt.format(a) + ' – ' + dateFmt.format(b);
  }

  /* "Sep 18, 2026 11:59 PM AoE" — in the offset the organisers published */
  function formatOriginal(ev) {
    var s = shifted(ev.startMs, ev.offset);
    if (ev.endMs) {
      return formatRange(s, shifted(ev.endMs, ev.offset), utcDate) + ' · ' + ev.offset.label;
    }
    return utcDate.format(s) + ' ' + utcTime.format(s) + ' ' + ev.offset.label;
  }

  /* the same moment in the viewer's time zone */
  function formatLocal(ev) {
    var s = new Date(ev.startMs);
    if (ev.endMs) return formatRange(s, new Date(ev.endMs), localDate) + ' ' + localTzName;
    return localDate.format(s) + ' ' + localTime.format(s) + ' ' + localTzName;
  }

  function split(ms) {
    ms = Math.max(0, ms);
    return {
      d: Math.floor(ms / DAY),
      h: Math.floor((ms % DAY) / HOUR),
      m: Math.floor((ms % HOUR) / MINUTE),
      s: Math.floor((ms % MINUTE) / SECOND)
    };
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function shortLabel(ev) {
    return ev.label.replace(/\bdeadline\b/i, '').replace(/\s+/g, ' ').trim().toLowerCase() || ev.kind;
  }

  function relative(ms) {
    var p = split(ms);
    if (p.d > 0) return p.d + 'd ' + p.h + 'h';
    if (p.h > 0) return p.h + 'h ' + p.m + 'm';
    return p.m + 'm ' + p.s + 's';
  }

  /* ---------- DOM ---------- */

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child !== null && child !== undefined) node.append(child);
    }
    return node;
  }

  function backLink() {
    return el('a', { class: 'back-link', href: location.pathname, text: '← All conferences' });
  }

  function render(confs, now) {
    root.replaceChildren();
    tickers = [];
    document.body.dataset.mode = focusId ? 'focus' : 'all';

    var view = focusId ? confs.filter(function (c) { return c.id === focusId; }) : confs;
    if (focusId) root.append(backLink());
    if (focusId && !view.length) {
      root.append(el('p', { class: 'empty', text: 'No conference with id "' + focusId + '".' }));
      return;
    }

    var active = [], past = [], tba = [];
    view.forEach(function (c) {
      var st = conferenceState(c, now);
      (st.status === 'past' ? past : st.status === 'tba' ? tba : active).push({ conf: c, state: st });
    });
    active.sort(function (a, b) { return a.state.sortKey - b.state.sortKey; });
    var nearest = active.length ? active[0].state.next : null;

    var list = el('div', { class: 'conferences' });
    active.concat(tba).forEach(function (item) {
      list.append(renderConference(item.conf, item.state, nearest));
    });
    root.append(list);

    if (past.length) {
      past.sort(function (a, b) { return b.state.endedMs - a.state.endedMs; });
      root.append(el('h2', { class: 'past-heading', text: 'Past' }));
      var ul = el('ul', { class: 'past-list' });
      past.forEach(function (item) { ul.append(renderPast(item.conf, item.state)); });
      root.append(ul);
    }
  }

  function renderConference(conf, state, nearest) {
    var section = el('section', { class: 'conference', 'data-status': state.status, id: 'conf-' + conf.id });
    var head = el('header', { class: 'conf-head' });
    var name = conf.url
      ? el('a', { href: conf.url, target: '_blank', rel: 'noopener', text: conf.name })
      : conf.name;
    head.append(el('h2', { class: 'conf-name' }, name));
    var meta = el('p', { class: 'conf-meta' }, el('span', { class: 'conf-location', text: conf.location || 'TBA' }));
    if (!focusId) {
      meta.append(el('a', { class: 'focus-link', href: '?conf=' + encodeURIComponent(conf.id), title: 'Wall display for ' + conf.name, text: 'Focus' }));
    }
    head.append(meta);
    if (conf.note) head.append(el('p', { class: 'conf-note', text: conf.note }));
    section.append(head);

    if (state.status === 'tba') {
      section.append(el('div', { class: 'card card-tba' }, el('p', { class: 'tba-text', text: 'Dates not announced yet' })));
      return section;
    }

    var events = state.events;
    if (focusId && focusEvent !== null) {
      var picked = events.filter(function (x) { return x.ev.index === focusEvent; });
      if (picked.length) events = picked;
    }

    var passed = events.filter(function (x) { return x.status === 'past'; });
    var current = events.filter(function (x) { return x.status !== 'past'; })
      .sort(function (a, b) { return a.ev.startMs - b.ev.startMs; });

    if (passed.length) {
      var ul = el('ul', { class: 'passed' });
      passed.forEach(function (x) {
        ul.append(el('li', {},
          el('span', { class: 'passed-label', text: x.ev.label }),
          ' passed · ',
          el('time', { datetime: x.ev.start, text: formatOriginal(x.ev) })));
      });
      section.append(ul);
    }

    if (current.length) {
      var spanFirst = Boolean(focusId) || current[0].ev === nearest;
      var cards = el('div', {
        class: 'cards',
        'data-span-first': spanFirst ? 'true' : null,
        'data-secondary': spanFirst ? String(current.length - 1) : null
      });
      current.forEach(function (x, i) {
        cards.append(renderCard(conf, x.ev, x.status, x.ev === nearest, i === 0));
      });
      section.append(cards);
    }
    return section;
  }

  function renderCard(conf, ev, status, isNearest, isPrimary) {
    var card = el('article', {
      class: 'card',
      'data-kind': ev.kind,
      'data-status': status,
      'data-nearest': isNearest ? 'true' : null,
      'data-primary': isPrimary ? 'true' : null
    });
    card.append(el('div', { class: 'card-top' },
      el('h3', { class: 'event-label', text: ev.label }),
      el('span', { class: 'kind', text: status === 'live' ? 'Happening now · ends in' : ev.kind })));

    var digits = el('div', { class: 'digits', role: 'timer' });
    var nodes = {};
    [['d', 'days'], ['h', 'hours'], ['m', 'minutes'], ['s', 'seconds']].forEach(function (u) {
      var value = el('span', { class: 'value', text: '–' });
      nodes[u[0]] = value;
      digits.append(el('div', { class: 'unit', 'data-unit': u[0] }, value, el('span', { class: 'unit-label', text: u[1] })));
    });
    card.append(digits);

    card.append(el('div', { class: 'when' },
      el('time', { class: 'when-original', datetime: ev.start, text: formatOriginal(ev) }),
      el('span', { class: 'when-local', text: formatLocal(ev) })));

    tickers.push({ ev: ev, conf: conf, status: status, nodes: nodes, card: card });
    return card;
  }

  function renderPast(conf, state) {
    var li = el('li', {});
    li.append(conf.url
      ? el('a', { href: conf.url, target: '_blank', rel: 'noopener', text: conf.name })
      : el('span', { text: conf.name }));
    var ended = new Date(state.endedMs);
    li.append(el('span', { text: 'Ended ' + localDate.format(ended) + (conf.location && conf.location !== 'TBA' ? ' · ' + conf.location : '') }));
    return li;
  }

  /* ---------- ticking ---------- */

  function updateTitle(now) {
    var view = focusId ? conferences.filter(function (c) { return c.id === focusId; }) : conferences;
    var best = null, bestConf = null, bestAny = null, bestAnyConf = null;
    view.forEach(function (c) {
      c.events.forEach(function (ev) {
        if (eventStatus(ev, now) !== 'upcoming') return;
        if (!bestAny || ev.startMs < bestAny.startMs) { bestAny = ev; bestAnyConf = c; }
        if (ev.kind === 'deadline' && (!best || ev.startMs < best.startMs)) { best = ev; bestConf = c; }
      });
    });
    if (!best) { best = bestAny; bestConf = bestAnyConf; }
    var title = best
      ? relative(best.startMs - now) + ' to ' + bestConf.name + ' ' + shortLabel(best)
      : baseTitle;
    if (title !== lastTitle) { lastTitle = title; document.title = title; }
  }

  function tick() {
    var now = Date.now();
    var sig = signature(conferences, now);
    if (sig !== lastSignature) {
      lastSignature = sig;
      render(conferences, now);
    }
    tickers.forEach(function (t) {
      var target = t.status === 'live' ? t.ev.endMs : t.ev.startMs;
      var remaining = target - now;
      var p = split(remaining);
      t.nodes.d.textContent = String(p.d);
      t.nodes.h.textContent = pad(p.h);
      t.nodes.m.textContent = pad(p.m);
      t.nodes.s.textContent = pad(p.s);
      var urgency = t.status === 'live' ? 'live' : remaining < DAY ? 'urgent' : remaining < 7 * DAY ? 'warning' : 'calm';
      if (t.card.dataset.urgency !== urgency) t.card.dataset.urgency = urgency;
    });
    if (nowLocalNode) nowLocalNode.textContent = localClock.format(now) + ' ' + localTzName;
    if (nowAoeNode) nowAoeNode.textContent = utcClock.format(now - 12 * HOUR) + ' AoE';
    updateTitle(now);
  }

  function start() {
    tick();
    setTimeout(function () {
      tick();
      setInterval(tick, SECOND);
    }, SECOND - (Date.now() % SECOND));
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick();
    });
  }

  loadData()
    .then(function (raw) {
      if (!Array.isArray(raw)) throw new Error('conferences.json must be an array');
      conferences = prepare(raw);
      start();
    })
    .catch(function (err) {
      console.error(err);
      root.replaceChildren(el('p', { class: 'empty', text: 'Could not load conference data: ' + err.message }));
    });
})();
