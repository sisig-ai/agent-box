const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function seconds(ts) {
  const n = Number(ts);
  const value = n > 1e12 ? n / 1000 : n;
  return Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value * 1000).getTime())
    ? value : null;
}

export function manilaDay(now = Date.now()) {
  const ts = seconds(now) || seconds(Date.now());
  return dayFormat.format(new Date(ts * 1000));
}

export function dayPages(events, selected, now = Date.now()) {
  const groups = new Map();
  events.slice().sort((a, b) => (seconds(b.ts) || 0) - (seconds(a.ts) || 0)).forEach((event) => {
    const ts = seconds(event.ts);
    const key = ts === null ? 'unknown' : dayFormat.format(new Date(ts * 1000));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  const today = manilaDay(now);
  if (events.length && !groups.has(today)) groups.set(today, []);
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return b.localeCompare(a);
  });
  const withCloses = keys.find((key) => groups.get(key).length);
  const key = groups.has(selected) ? selected : (withCloses || keys[0] || null);
  const index = keys.indexOf(key);
  return {
    keys, key, events: groups.get(key) || [], total: events.length,
    newer: keys[index - 1] || null, older: keys[index + 1] || null,
    today,
  };
}

export function createDayPager(root, paintList) {
  const pager = document.getElementById('gmgn-day-pager');
  const select = document.getElementById('gmgn-day');
  const newer = document.getElementById('gmgn-newer');
  const older = document.getElementById('gmgn-older');
  const count = document.getElementById('gmgn-trade-count');
  let events = [];
  let page = dayPages(events);
  function paint(selected) {
    page = dayPages(events, selected);
    select.replaceChildren(...page.keys.map((key) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = key === 'unknown' ? 'unknown date' : (key === page.today ? key + ' today' : key);
      return option;
    }));
    select.value = page.key || '';
    pager.hidden = !page.total;
    newer.disabled = !page.newer;
    older.disabled = !page.older;
    count.textContent = page.events.length + ' of ' + page.total;
    paintList(root, page.events);
    if (!page.events.length) {
      const empty = document.createElement('div');
      empty.className = 'gmgn-empty';
      empty.textContent = page.total ? 'no closes this day' : 'no runner closes yet';
      root.append(empty);
    }
  }
  select.addEventListener('change', () => paint(select.value));
  newer.addEventListener('click', () => paint(page.newer));
  older.addEventListener('click', () => paint(page.older));
  return (loaded) => {
    events = loaded;
    paint(page.key);
  };
}
