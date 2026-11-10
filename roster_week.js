/* SCP roster week page (candidate ra-c13).
   Design: Implementation/2026-11-09_Roster_Week_Page_Design_draft3.md sections 2, 2a, 4.2 and 4.3, with draft 4's
   selection rules (Implementation/2026-11-06_Roster_Day_By_Day_Card_Design_draft4.md section 4.3) and the brief's
   correction C3 (the data is read from the parameter rw, in the fragment first and the query string second).
   It only shows and collects: everything it sends is checked again by the desk against the card it holds.
   No inline script or style, no eval, no network request, no cookies or storage. */
(function () {
  "use strict";

  var VERSION = "roster-week-1";
  var SEND_MAX = 4000;
  var FAIL_LINE = "This card's data did not reach the page. Close it and use the buttons on the card.";
  var LIMITS = {men: 30, days: 5, jobs: 24, name: 20, code: 6, label: 18, rw: 8000};
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
                "November", "December"];

  // ------------------------------------------------------------ reading rw

  function paramFrom(text, name) {
    var s = String(text || "").replace(/^[#?]/, "");
    var q = s.indexOf("?");
    if (q >= 0 && s.indexOf("=") > q) {
      s = s.substr(q + 1);
    }
    var parts = s.split("&");
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf("=");
      if (eq > 0 && parts[i].substr(0, eq) === name) {
        return parts[i].substr(eq + 1);
      }
    }
    return null;
  }

  function readRw(hash, search) {
    var v = paramFrom(hash, "rw");
    if (v === null) {
      v = paramFrom(search, "rw");
    }
    return v;
  }

  function decodeRw(rw) {
    if (typeof rw !== "string" || !rw.length || rw.length > LIMITS.rw || !/^[A-Za-z0-9_-]+$/.test(rw)) {
      throw new Error("rw is not base64url");
    }
    var b = rw.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) {
      b += "=";
    }
    var text = atob(b);
    if (!/^[\x20-\x7e]*$/.test(text)) {
      throw new Error("rw is not ASCII JSON");
    }
    return JSON.parse(text);
  }

  function isInt(x, lo, hi) {
    return typeof x === "number" && Math.floor(x) === x && x >= lo && x <= hi;
  }

  function need(ok, why) {
    if (!ok) {
      throw new Error(why);
    }
  }

  // The card's data, checked against version roster-week-1 and the layout's limits. Throws on anything else.
  function validate(p) {
    need(p && typeof p === "object" && !Array.isArray(p), "not an object");
    need(p.v === VERSION, "version");
    need(typeof p.j === "string" && /^JOB-\d{6}$/.test(p.j), "job id");
    need(isInt(p.sv, 1, 9999), "send version");
    need(typeof p.n === "string" && /^[A-Za-z0-9_-]{22}$/.test(p.n), "nonce");
    need(p.k === "week" || p.k === "day", "kind");
    need(Array.isArray(p.d) && p.d.length >= 1 && p.d.length <= LIMITS.days && (p.k === "week" || p.d.length === 1),
         "days");
    for (var i = 0; i < p.d.length; i++) {
      need(typeof p.d[i] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.d[i]), "a day");
    }
    need(Array.isArray(p.o) && p.o.length <= LIMITS.jobs, "jobs");
    var letters = {};
    for (i = 0; i < p.o.length; i++) {
      var o = p.o[i];
      need(o && typeof o.l === "string" && /^[a-x]$/.test(o.l) && !letters[o.l], "a job letter");
      need(typeof o.c === "string" && /^[A-Z0-9]{1,6}$/.test(o.c), "a job code");
      need(typeof o.n === "string" && o.n.length >= 1 && o.n.length <= LIMITS.label, "a job label");
      need(o.p === 0 || o.p === 1, "a job's chip flag");
      letters[o.l] = o;
    }
    need(Array.isArray(p.m) && p.m.length >= 1 && p.m.length <= LIMITS.men, "men");
    var rows = {};
    for (i = 0; i < p.m.length; i++) {
      var m = p.m[i];
      need(m && isInt(m.r, 1, 99) && !rows[m.r], "a row");
      need(typeof m.s === "string" && m.s.length >= 1 && m.s.length <= LIMITS.name, "a short name");
      need(m.k === "c" || m.k === "l" || m.k === "i", "a row kind");
      need(Array.isArray(m.t) && m.t.length === p.d.length, "a man's days");
      for (var k = 0; k < m.t.length; k++) {
        var st = m.t[k];
        need(st === "z" || st === "l" || st === "o" || st === "2" || (typeof st === "string" && letters[st]),
             "a day's state");
      }
      rows[m.r] = true;
    }
    return p;
  }

  // ------------------------------------------------------------ the model (draft 4's selection rules)

  function Model(p) {
    this.p = p;
    this.jobs = {};
    for (var i = 0; i < p.o.length; i++) {
      this.jobs[p.o[i].l] = p.o[i];
    }
    this.chips = [];
    for (i = 0; i < p.o.length; i++) {
      if (p.o[i].p === 1) {
        this.chips.push(p.o[i].l);
      }
    }
    this.chips.push("z");
    this.men = [];
    for (i = 0; i < p.m.length; i++) {
      var m = p.m[i];
      this.men.push({r: m.r, s: m.s, k: m.k, t: m.t.slice(), whole: this.initialWhole(m), over: {}});
    }
  }

  Model.prototype.week = function () {
    return this.p.k === "week";
  };

  Model.prototype.initialWhole = function (m) {
    if (this.p.k === "week") {
      return "y";
    }
    var st = m.t[0];
    return /^[a-x]$/.test(st) || st === "z" ? st : "y";
  };

  // His rostered state on day i (1 is the first day): a letter, z, o (a job not on the card), l (leave) or 2.
  Model.prototype.rostered = function (man, i) {
    return man.t[i - 1];
  };

  Model.prototype.locked = function (man, i) {
    var st = this.rostered(man, i);
    return man.k !== "c" || st === "l" || st === "2" || (!this.week() && st === "o");
  };

  Model.prototype.sameDay = function (man, i, a, b) {
    if (a === b) {
      return true;
    }
    if (a === "y" || b === "y") {
      return (a === "y" ? b : a) === this.rostered(man, i);
    }
    return false;
  };

  Model.prototype.letterFor = function (man, i) {
    return Object.prototype.hasOwnProperty.call(man.over, i) ? man.over[i] : man.whole;
  };

  // What the square shows: a job letter, z, or (As rostered) his rostered state.
  Model.prototype.shown = function (man, i) {
    var l = this.letterFor(man, i);
    return l === "y" ? this.rostered(man, i) : l;
  };

  Model.prototype.differs = function (man, i) {
    if (this.locked(man, i)) {
      return false;
    }
    return this.shown(man, i) !== this.rostered(man, i);
  };

  // Painting a square sets that day's override; one that gives the same day as his whole-card letter (painting it
  // back to his roster while he is As rostered) is not kept. A weekday card has one square a man: it sets his letter.
  Model.prototype.paint = function (man, i, chip) {
    if (this.locked(man, i)) {
      return false;
    }
    if (!this.week()) {
      man.whole = chip;
      return true;
    }
    man.over[i] = chip;
    if (this.sameDay(man, i, chip, man.whole)) {
      delete man.over[i];
    }
    return true;
  };

  // Tapping a name paints every day of his not on leave and clears his overrides.
  Model.prototype.nameTap = function (man, chip) {
    if (man.k !== "c") {
      return false;
    }
    if (!this.week()) {
      return this.paint(man, 1, chip);
    }
    man.whole = chip;
    man.over = {};
    var all = true;
    for (var i = 1; i <= this.p.d.length; i++) {
      if (this.rostered(man, i) !== "l" && this.rostered(man, i) !== chip) {
        all = false;
      }
    }
    if (all) {
      man.whole = "y";  // the same as As rostered on every day: nothing to send for him
    }
    return true;
  };

  Model.prototype.changeCount = function () {
    var n = 0;
    for (var j = 0; j < this.men.length; j++) {
      for (var i = 1; i <= this.p.d.length; i++) {
        if (this.differs(this.men[j], i)) {
          n++;
        }
      }
    }
    return n;
  };

  Model.prototype.codeOf = function (st) {
    if (st === "z") {
      return "Off";
    }
    if (st === "l") {
      return "Leave";
    }
    if (st === "o") {
      return "other";
    }
    if (st === "2") {
      return "2 jobs";
    }
    return this.jobs[st] ? this.jobs[st].c : st;
  };

  Model.prototype.changeLine = function () {
    var out = [];
    for (var j = 0; j < this.men.length; j++) {
      for (var i = 1; i <= this.p.d.length; i++) {
        if (this.differs(this.men[j], i)) {
          out.push(this.men[j].s + " " + dayShort(this.p.d[i - 1]) + " " + this.codeOf(this.shown(this.men[j], i)));
        }
      }
    }
    return out.join(", ");
  };

  // Draft 4's form, only the entries that differ from As rostered: "<row>" a whole-card letter, "<row>.<day>" a day.
  Model.prototype.selection = function () {
    var sel = {};
    for (var j = 0; j < this.men.length; j++) {
      var man = this.men[j];
      if (man.k !== "c") {
        continue;
      }
      if (!this.week()) {
        if (man.whole !== this.initialWhole(man)) {
          sel[String(man.r)] = man.whole;
        }
        continue;
      }
      if (man.whole !== "y") {
        sel[String(man.r)] = man.whole;
      }
      for (var i = 1; i <= this.p.d.length; i++) {
        if (Object.prototype.hasOwnProperty.call(man.over, i)) {
          sel[man.r + "." + i] = man.over[i];
        }
      }
    }
    return sel;
  };

  Model.prototype.answer = function () {
    return JSON.stringify({version: VERSION, job_id: this.p.j, send_version: this.p.sv, nonce: this.p.n,
                           selection: this.selection()});
  };

  function dateParts(iso) {
    var y = +iso.substr(0, 4), mo = +iso.substr(5, 2), d = +iso.substr(8, 2);
    var wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    return {wd: wd, d: d, mo: mo};
  }

  function dayShort(iso) {
    return DAYS[dateParts(iso).wd].substr(0, 3);
  }

  function dayLong(iso) {
    var x = dateParts(iso);
    return DAYS[x.wd] + " " + x.d + " " + MONTHS[x.mo - 1];
  }

  function buttonText(n) {
    if (n === 0) {
      return "No changes - close";
    }
    return n === 1 ? "Save 1 change" : "Save " + n + " changes";
  }

  // ------------------------------------------------------------ the page

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) {
      e.className = cls;
    }
    if (text !== undefined) {
      e.textContent = text;
    }
    return e;
  }

  function Page(tg, root) {
    this.tg = tg;
    this.root = root;
    this.model = null;
    this.chip = null;
    this.squares = [];
    this.names = [];
    this.chipButtons = [];
  }

  Page.prototype.fail = function () {
    var self = this;
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    var box = el("div", "rw-fail");
    box.appendChild(el("p", "", FAIL_LINE));
    var b = el("button", "rw-close", "Close");
    b.setAttribute("type", "button");
    b.addEventListener("click", function () { self.close(); });
    box.appendChild(b);
    this.root.appendChild(box);
    this.mode = "fail";
    if (this.tg) {
      this.tg.MainButton.setText("Close");
      this.tg.MainButton.show();
    }
  };

  Page.prototype.close = function () {
    if (this.tg) {
      this.tg.close();
    }
  };

  Page.prototype.build = function (model) {
    var self = this, p = model.p, i, j;
    this.model = model;
    this.mode = "grid";
    this.chip = model.chips[0];
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    var app = el("div", "rw");
    app.style.setProperty("--days", String(p.d.length));
    var head = el("div", "rw-row rw-head");
    head.appendChild(el("div", "rw-day", ""));
    for (i = 0; i < p.d.length; i++) {
      var x = dateParts(p.d[i]);
      head.appendChild(el("div", "rw-day", DAYS[x.wd].substr(0, 3) + " " + x.d));
    }
    app.appendChild(head);
    var grid = el("div", "rw-grid");
    grid.setAttribute("role", "grid");
    for (j = 0; j < model.men.length; j++) {
      var man = model.men[j];
      var row = el("div", "rw-row");
      row.setAttribute("role", "row");
      var nb = el("button", "rw-name", man.s);
      nb.setAttribute("type", "button");
      if (man.k !== "c") {
        nb.disabled = true;
      }
      nb.addEventListener("click", this.onName.bind(this, man));
      this.names.push({man: man, b: nb});
      row.appendChild(nb);
      for (i = 1; i <= p.d.length; i++) {
        var sq = el("button", "rw-sq");
        sq.setAttribute("type", "button");
        var code = el("span", "rw-code");
        sq.appendChild(code);
        sq.addEventListener("click", this.onSquare.bind(this, man, i));
        this.squares.push({man: man, i: i, b: sq, code: code});
        row.appendChild(sq);
      }
      grid.appendChild(row);
    }
    app.appendChild(grid);
    var foot = el("div", "rw-foot");
    var chips = el("div", "rw-chips" + (model.chips.length > 12 ? " rw-scroll" : ""));
    chips.setAttribute("role", "radiogroup");
    chips.setAttribute("aria-label", "Paint with");
    for (i = 0; i < model.chips.length; i++) {
      var c = model.chips[i];
      var job = model.jobs[c];
      var cb = el("button", "rw-chip " + (c === "z" ? "rw-off" : "rw-" + c), c === "z" ? "Off" : job.c);
      cb.setAttribute("type", "button");
      cb.setAttribute("role", "radio");
      cb.setAttribute("aria-label", "Paint with " + (c === "z" ? "Off" : job.n));
      cb.addEventListener("click", this.onChip.bind(this, c));
      this.chipButtons.push({c: c, b: cb});
      chips.appendChild(cb);
    }
    foot.appendChild(chips);
    this.changeEl = el("div", "rw-change");
    this.changeEl.setAttribute("aria-live", "polite");
    foot.appendChild(this.changeEl);
    app.appendChild(foot);
    this.root.appendChild(app);
    this.draw();
    this.fitCodes();
  };

  Page.prototype.onChip = function (c) {
    this.chip = c;
    this.draw();
  };

  Page.prototype.onSquare = function (man, i) {
    if (this.model.paint(man, i, this.chip)) {
      this.draw();
      this.fitCodes();
    }
  };

  Page.prototype.onName = function (man) {
    if (this.model.nameTap(man, this.chip)) {
      this.draw();
      this.fitCodes();
    }
  };

  Page.prototype.draw = function () {
    var model = this.model, p = model.p, k;
    for (k = 0; k < this.squares.length; k++) {
      var s = this.squares[k];
      var st = model.shown(s.man, s.i);
      var locked = model.locked(s.man, s.i);
      var changed = model.differs(s.man, s.i);
      var cls = "rw-sq";
      if (st === "z") {
        cls += " rw-off";
      } else if (st === "l" || st === "2") {
        cls += " rw-locked";
      } else if (st === "o") {
        cls += " rw-other";
      } else {
        cls += " rw-" + st;
      }
      s.b.className = cls;
      s.code.textContent = st === "z" ? "off" : model.codeOf(st);
      s.b.disabled = locked;
      if (locked) {
        s.b.setAttribute("aria-disabled", "true");
      }
      var dot = s.b.querySelector ? s.b.querySelector(".rw-dot") : null;
      if (changed && !dot) {
        dot = el("span", "rw-dot");
        dot.setAttribute("aria-hidden", "true");
        s.b.appendChild(dot);
      } else if (!changed && dot) {
        s.b.removeChild(dot);
      }
      var what = st === "z" ? "Off" : st === "l" ? "on leave" : st === "2" ? "two jobs" :
          st === "o" ? "a job not on this card" : model.jobs[st].c;
      s.b.setAttribute("aria-label", s.man.s + ", " + dayLong(p.d[s.i - 1]) + ", " + what +
                       (changed ? ", changed" : "") + (locked ? ", locked" : ""));
    }
    for (k = 0; k < this.names.length; k++) {
      var nm = this.names[k];
      nm.b.setAttribute("aria-label", nm.man.k === "c" ? nm.man.s + ", paint every day not on leave" :
                        nm.man.s + ", locked");
    }
    for (k = 0; k < this.chipButtons.length; k++) {
      this.chipButtons[k].b.setAttribute("aria-checked", this.chipButtons[k].c === this.chip ? "true" : "false");
    }
    this.changeEl.textContent = model.changeLine();
    if (this.tg) {
      this.tg.MainButton.setText(buttonText(model.changeCount()));
    }
  };

  // A code wider than its square drops to 12 points, never smaller; one that still does not fit goes onto two lines.
  Page.prototype.fitCodes = function () {
    for (var k = 0; k < this.squares.length; k++) {
      var c = this.squares[k].code;
      c.className = "rw-code";
      if (c.scrollWidth > c.clientWidth) {
        c.className = "rw-code rw-12";
        if (c.scrollWidth > c.clientWidth) {
          c.className = "rw-code rw-12 rw-wrap";
        }
      }
    }
  };

  Page.prototype.onMain = function () {
    if (this.mode !== "grid") {
      this.close();
      return;
    }
    var n = this.model.changeCount();
    if (n === 0) {
      this.close();
      return;
    }
    var data = this.model.answer();
    if (data.length > SEND_MAX) {
      this.changeEl.textContent = "Too many changes to send at once. Close the page and use the buttons on the card.";
      return;
    }
    this.tg.sendData(data);
  };

  Page.prototype.start = function (hash, search) {
    var tg = this.tg;
    if (tg) {
      tg.ready();
      tg.expand();
      if (tg.isVersionAtLeast && tg.isVersionAtLeast("7.7")) {
        tg.disableVerticalSwipes();
      }
      applyTheme(tg);
      tg.onEvent("themeChanged", function () { applyTheme(tg); });
      tg.MainButton.onClick(this.onMain.bind(this));
    }
    var model = null;
    try {
      model = new Model(validate(decodeRw(readRw(hash, search))));
    } catch (e) {
      model = null;
    }
    if (model) {
      this.build(model);
    } else {
      this.fail();
    }
    if (tg) {
      tg.MainButton.show();
    }
    return this;
  };

  function applyTheme(tg) {
    var dark = tg.colorScheme === "dark";
    document.documentElement.className = dark ? "dark" : "";
  }

  var api = {VERSION: VERSION, FAIL_LINE: FAIL_LINE, readRw: readRw, decodeRw: decodeRw, validate: validate,
             Model: Model, Page: Page, buttonText: buttonText};
  window.RosterWeek = api;
  if (!window.RosterWeekNoStart) {
    var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    api.page = new Page(tg, document.getElementById("app")).start(location.hash, location.search);
  }
})();
