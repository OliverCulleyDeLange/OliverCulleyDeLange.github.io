export function drawCvTimeline(root = document) {
  const container = root.querySelector('#timeline');
  if (!container || container.dataset.rendered) return;
  container.dataset.rendered = 'true';

  const firstYear = 2014;
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth(), now.getDate()];
  const year = ([y, month, day = 1]) => y + (month + (day - 1) / 31) / 12;
  const lastYear = year(today);
  const groups = [
    { label: '', className: 'roles', height: 44, items: [
      ['Backend Java', [2014, 3], [2018, 6], 28, 'role'],
      ['Full stack', [2018, 6], [2019, 5], 28, 'role'],
      ['Android', [2020, 3], today, 28, 'role'],
    ] },
    { label: 'Projects', height: 70, items: [
      ['WeClimb.Rocks: Android, Kotlin', [2015, 9], [2019, 11], 8, 'project purple'],
      ['Cheat To Win: Flutter', [2019, 7], [2020, 3], 38, 'project green'],
      ['Location Alarm: KMM, Compose, SwiftUI', [2024, 11], [2025, 3], 8, 'project yellow'],
      ['GrvMkr: Svelte on Web', [2025, 2], [2025, 6], 38, 'project red'],
    ] },
    { label: 'Employment', height: 64, items: [
      ['O2 — Java, Spring, Appium, AWS', [2014, 3], [2017, 4], 8, 'employment o2'],
      ['O2 — JS / TS, React, Express, Serverless, AWS', [2018, 6], [2019, 5], 8, 'employment o2'],
      ['Carv — Android, Kotlin, Rust, Bluetooth', [2020, 3], [2024, 4, 31], 38, 'employment carv'],
      ['Freelance', [2025, 5], [2025, 8], 38, 'employment freelance'],
      ['Carv — Senior Android', [2025, 8], today, 38, 'employment carv'],
    ] },
    { label: 'Travel', className: 'breaks', height: 50, items: [
      ['Nepal, Europe', [2017, 4], [2018, 3], 19, 'break'],
      ['AUS, NZ, Bali', [2019, 5], [2020, 3], 19, 'break'],
      ['NZ, AUS, SA, USA, CAD', [2024, 5], [2025, 4], 19, 'break'],
    ] },
  ];

  const chart = document.createElement('div');
  chart.className = 'cv-timeline';
  const percent = value => ((year(value) - firstYear) / (lastYear - firstYear)) * 100;
  groups.forEach(group => {
    const row = document.createElement('div');
    row.className = `cv-timeline-row ${group.className ?? ''}`.trim();
    row.style.height = `${group.height}px`;
    const label = document.createElement('span');
    label.className = 'cv-timeline-group';
    label.textContent = group.label;
    const track = document.createElement('div');
    track.className = 'cv-timeline-track';
    track.style.setProperty('--year-step', `${100 / (lastYear - firstYear)}%`);
    group.items.forEach(([text, start, end, top, kind]) => {
      const left = percent(start);
      const width = percent(end) - left;
      const item = document.createElement('span');
      item.className = `cv-timeline-item ${kind}`;
      if (kind.includes('break') && left > 72) item.classList.add('is-right');
      Object.assign(item.style, { left: `${left}%`, width: `${Math.max(width, 1.5)}%`, top: `${top}px` });
      item.title = text;
      if (kind === 'role') {
        item.textContent = text;
      } else {
        const itemLabel = document.createElement('span');
        itemLabel.className = 'cv-timeline-text';
        itemLabel.textContent = text;
        const labelAbove = kind.includes('freelance');
        if (labelAbove) itemLabel.classList.add('is-above');
        const isTravel = kind.includes('break');
        itemLabel.style.top = `${labelAbove ? top - 10 : top + (isTravel ? 1 : 12)}px`;
        if (left > 72) {
          itemLabel.classList.add('is-right');
          itemLabel.style.right = `${Math.max(0, 100 - left - width)}%`;
        } else {
          itemLabel.style.left = `${left}%`;
        }
        track.appendChild(itemLabel);
      }
      track.appendChild(item);
    });
    row.append(label, track);
    chart.appendChild(row);
  });

  const axis = document.createElement('div');
  axis.className = 'cv-timeline-axis';
  for (let y = 2015; y <= Math.floor(lastYear); y++) {
    const tick = document.createElement('span');
    tick.textContent = String(y);
    tick.style.left = `${((y - firstYear) / (lastYear - firstYear)) * 100}%`;
    axis.appendChild(tick);
  }
  chart.appendChild(axis);
  container.replaceChildren(chart);
}
