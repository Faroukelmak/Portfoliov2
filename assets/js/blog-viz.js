/*
 * Animated explainers for blog articles.
 * In Markdown:  <div class="viz" data-viz="agent-loop"></div>
 * Available:    agent-loop, summarization, human-in-the-loop
 * Labels follow <html lang>. With prefers-reduced-motion the final state is shown, no animation.
 */
(function () {
  var EN = document.documentElement.lang === 'en';
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var L = function (fr, en) { return EN ? en : fr; };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, REDUCED ? 0 : ms); }); };
  var el = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  var ICON = {
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5l12 7-12 7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6v12M15 6v12"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01"/></svg>',
    tool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 005.4-5.4l-2.5 2.5-2.5-2.5z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 16h6"/></svg>',
  };

  /* run a scene forever, only while visible */
  function loop(root, scene) {
    var visible = false, running = false;
    async function run() {
      if (running) return; running = true;
      do { await scene(); if (REDUCED) break; await wait(1600); } while (visible);
      running = false;
    }
    if (REDUCED || !('IntersectionObserver' in window)) { scene(); return; }
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting; if (visible) run();
    }, { threshold: 0.35 }).observe(root);
  }

  /* ------------------------------------------------------------ 1. agent loop */
  function agentLoop(root) {
    var steps = [
      ['node', ICON.user, L('Message', 'Message'), ''],
      ['hook', '', 'before_model', L('Résumé de l\'historique', 'Summarize history')],
      ['node', ICON.bot, L('Modèle', 'Model'), ''],
      ['hook', '', 'after_model', L('Validation humaine', 'Human approval')],
      ['node', ICON.tool, L('Outil', 'Tool'), ''],
      ['node', ICON.check, L('Réponse', 'Answer'), ''],
    ];
    var row = el('div', 'vz-loop');
    var items = steps.map(function (s, i) {
      var it = el('div', 'vz-step vz-' + s[0],
        (s[1] ? '<span class="vz-ic">' + s[1] + '</span>' : '') +
        '<span class="vz-t">' + s[2] + '</span>' + (s[3] ? '<span class="vz-s">' + s[3] + '</span>' : ''));
      row.appendChild(it);
      if (i < steps.length - 1) row.appendChild(el('span', 'vz-arrow', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'));
      return it;
    });
    var back = el('div', 'vz-back', L('L\'outil renvoie son résultat au modèle, puis la boucle recommence', 'The tool sends its result back to the model, then the loop starts again'));
    root.append(row, back);
    loop(root, async function () {
      for (var i = 0; i < items.length; i++) {
        items.forEach(function (x, j) { x.classList.toggle('on', j === i); x.classList.toggle('done', j < i); });
        await wait(i === 1 || i === 3 ? 1500 : 900);
      }
      if (REDUCED) items.forEach(function (x) { x.classList.remove('on'); x.classList.add('done'); });
      else { await wait(600); items.forEach(function (x) { x.classList.remove('on', 'done'); }); }
    });
  }

  /* ------------------------------------------------------------ 2. summarization */
  function summarization(root) {
    var head = el('div', 'vz-head');
    var count = el('span', 'vz-count');
    var rule = el('span', 'vz-rule', 'trigger <b>10</b> · keep <b>4</b>');
    head.append(count, rule);
    var list = el('div', 'vz-msgs');
    var note = el('div', 'vz-note');
    root.append(head, list, note);
    var setCount = function (n, hot) { count.innerHTML = '<b>' + n + '</b> messages'; count.classList.toggle('hot', !!hot); };
    var msg = function (who, n) {
      var m = el('div', 'vz-msg ' + (who === 'q' ? 'q' : 'a'),
        '<span class="vz-ic">' + (who === 'q' ? ICON.user : ICON.bot) + '</span>' +
        (who === 'q' ? L('Question ', 'Question ') : L('Réponse ', 'Answer ')) + n);
      list.appendChild(m); requestAnimationFrame(function () { m.classList.add('in'); });
      return m;
    };
    loop(root, async function () {
      list.innerHTML = ''; note.textContent = ''; setCount(0);
      var all = [];
      for (var i = 1; i <= 5; i++) {
        all.push(msg('q', i)); setCount(all.length); await wait(380);
        all.push(msg('a', i)); setCount(all.length); await wait(380);
      }
      all.push(msg('q', 6)); setCount(all.length, true);
      note.textContent = L('11 messages, le seuil de 10 est dépassé', '11 messages, the threshold of 10 is exceeded');
      await wait(1300);
      var old = all.slice(0, all.length - 4), kept = all.slice(-4);
      old.forEach(function (m) { m.classList.add('old'); });
      kept.forEach(function (m) { m.classList.add('kept'); });
      note.textContent = L('Les 4 derniers sont gardés, les 7 autres vont être résumés', 'The last 4 are kept, the other 7 will be summarized');
      await wait(1800);
      old.forEach(function (m) { m.classList.add('gone'); });
      await wait(REDUCED ? 0 : 500);
      old.forEach(function (m) { m.remove(); });
      var sum = el('div', 'vz-msg sum', '<span class="vz-ic">' + ICON.doc + '</span>' + L('Résumé de la conversation', 'Summary of the conversation'));
      list.insertBefore(sum, list.firstChild); requestAnimationFrame(function () { sum.classList.add('in'); });
      setCount(5);
      note.textContent = L('7 messages remplacés par 1 résumé', '7 messages replaced by 1 summary');
      await wait(1300);
      kept.forEach(function (m) { m.classList.remove('kept'); });
      msg('a', 6); setCount(6);
      note.textContent = L('Le modèle répond, l\'historique repart de 6 messages', 'The model answers, the history restarts from 6 messages');
      await wait(2200);
    });
  }

  /* ------------------------------------------------------------ 3. human in the loop */
  function hitl(root) {
    var lane = el('div', 'vz-hitl');
    var s1 = el('div', 'vz-card', '<span class="vz-ic">' + ICON.user + '</span><div><small>' + L('Utilisateur', 'User') + '</small>' + L('Envoie un email à john@example.com', 'Send an email to john@example.com') + '</div>');
    var s2 = el('div', 'vz-card', '<span class="vz-ic">' + ICON.bot + '</span><div><small>' + L('Agent', 'Agent') + '</small><code>send_email(recipient="<span class="vz-rcpt">john@example.com</span>")</code></div>');
    var s3 = el('div', 'vz-card pause', '<span class="vz-ic">' + ICON.pause + '</span><div><small>Middleware</small>' + L('Pause, en attente d\'une décision', 'Paused, waiting for a decision') + '</div>');
    var choices = el('div', 'vz-choices');
    var bA = el('span', 'vz-choice approve', ICON.check + 'approve');
    var bE = el('span', 'vz-choice edit', ICON.pen + 'edit');
    var bR = el('span', 'vz-choice reject', ICON.cross + 'reject');
    choices.append(bA, bE, bR);
    var s4 = el('div', 'vz-card result', '<span class="vz-ic">' + ICON.mail + '</span><div><small class="vz-rtitle"></small><span class="vz-rtext"></span></div>');
    lane.append(s1, s2, s3, choices, s4);
    root.appendChild(lane);
    var cards = [s1, s2, s3, choices, s4];
    var rcpt = s2.querySelector('.vz-rcpt');
    var scenarios = [
      [bA, L('Outil exécuté', 'Tool executed'), L('Email envoyé à john@example.com', 'Email sent to john@example.com'), 'ok', null],
      [bE, L('Outil exécuté avec les arguments modifiés', 'Tool executed with the edited arguments'), L('Email envoyé à jane@example.com', 'Email sent to jane@example.com'), 'ok', 'jane@example.com'],
      [bR, L('Outil non exécuté', 'Tool not executed'), L('L\'agent est informé du refus', 'The agent is told the call was rejected'), 'no', null],
    ];
    var k = 0;
    loop(root, async function () {
      var sc = scenarios[REDUCED ? 0 : k++ % scenarios.length];
      cards.forEach(function (c) { c.classList.remove('in', 'live'); });
      [bA, bE, bR].forEach(function (b) { b.classList.remove('picked', 'dim'); });
      rcpt.textContent = 'john@example.com'; rcpt.classList.remove('edited');
      s4.classList.remove('ok', 'no');
      for (var i = 0; i < 3; i++) { cards[i].classList.add('in', 'live'); await wait(i === 2 ? 1300 : 900); cards[i].classList.remove('live'); }
      s3.classList.add('live');
      choices.classList.add('in'); await wait(900);
      sc[0].classList.add('picked'); [bA, bE, bR].forEach(function (b) { if (b !== sc[0]) b.classList.add('dim'); });
      await wait(700);
      if (sc[4]) { rcpt.textContent = sc[4]; rcpt.classList.add('edited'); await wait(900); }
      s3.classList.remove('live');
      s4.querySelector('.vz-rtitle').textContent = sc[1];
      s4.querySelector('.vz-rtext').textContent = sc[2];
      s4.classList.add('in', sc[3]);
      await wait(2200);
    });
  }

  var VIZ = { 'agent-loop': agentLoop, summarization: summarization, 'human-in-the-loop': hitl };
  document.querySelectorAll('.viz[data-viz]').forEach(function (root) {
    var fn = VIZ[root.dataset.viz]; if (fn) fn(root);
  });
})();
