/**
 * pf_anim.js — live simulations for the Path Following Guidance page.
 *
 *  1. #pf-sim2d  : planar fixed-time path following in wind
 *                  (Kumar, Sinha & Kumar, Aerospace Sci. Tech. 2024).
 *  2. #pf-sim3d  : 3D fixed-time path following, rotating view
 *                  (Kumar, Kumar & Sinha, AIAA JGCD 2024).
 *  3. #pf-sat    : smooth input-saturation model used by the bounded-input designs
 *                  (AIAA JGCD 2026 / SciTech 2026).
 *  4. #pf-ct     : cross-track guidance, terminal sliding mode (AIAA GNC 2023)
 *                  vs nested saturation (ASCC 2026 / AST 2026), same paths and starts.
 *  5. #pe-sim     : pursuer-evader-defender engagement (Cooperative Pursuit-Evasion page).
 *  6. #pe-multi   : 20 defenders vs 20 pursuers with one-to-one assignment.
 *
 * Everything is simulated in the browser from the guidance laws in the papers.
 */
(function () {
  'use strict';

  /* ───────────────────────── shared helpers ───────────────────────── */
  var DEG = Math.PI / 180;
  var COLORS = ['#16a34a', '#2563eb', '#c026d3', '#ea580c', '#0891b2', '#7c3aed', '#dc2626'];
  var AMBER = '#d97706';
  var WIND = '#0d9488';

  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function sgn(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  function theme() {
    var d = isDark();
    return {
      bg: d ? '#0f1b30' : '#ffffff',
      grid: d ? 'rgba(148,163,184,0.10)' : 'rgba(15,23,42,0.06)',
      axis: d ? 'rgba(148,163,184,0.35)' : 'rgba(15,23,42,0.25)',
      text: d ? '#cbd5e1' : '#1e293b',
      muted: d ? '#94a3b8' : '#64748b',
      path: d ? 'rgba(226,232,240,0.55)' : 'rgba(10,22,40,0.45)',
      halo: d ? 'rgba(15,27,48,0.85)' : 'rgba(255,255,255,0.85)'
    };
  }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Size a canvas for the device pixel ratio; returns a 2D context in CSS pixels.
  function fitCanvas(cv) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  // Run `step(dt)` every frame while the element is on screen and not paused.
  function animator(el, step) {
    var visible = false, last = null, raf = null;
    var api = { paused: reduceMotion };
    function loop(ts) {
      raf = null;
      if (!visible) { last = null; return; }
      var dt = last === null ? 0 : Math.min((ts - last) / 1000, 0.25);
      last = ts;
      step(api.paused ? 0 : dt);
      raf = requestAnimationFrame(loop);
    }
    function kick() { if (raf === null && visible) raf = requestAnimationFrame(loop); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; kick(); }, { threshold: 0.05 }).observe(el);
    } else { visible = true; kick(); }
    api.kick = kick;
    return api;
  }

  function drawArrow(ctx, x0, y0, x1, y1, color, width, head) {
    var a = Math.atan2(y1 - y0, x1 - x0); head = head || 7;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width || 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - Math.cos(a) * head * 0.6, y1 - Math.sin(a) * head * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(a - 0.4), y1 - head * Math.sin(a - 0.4));
    ctx.lineTo(x1 - head * Math.cos(a + 0.4), y1 - head * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fill();
  }

  // Top-view aircraft glyph centred at (x,y) with nose along screen angle a.
  function drawPlane(ctx, x, y, a, size, color, halo) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(size / 10, size / 10);
    ctx.beginPath();
    ctx.moveTo(11, 0); ctx.lineTo(5.5, 1.4); ctx.lineTo(2, 1.4); ctx.lineTo(-1.5, 11); ctx.lineTo(-4.5, 11);
    ctx.lineTo(-3, 1.4); ctx.lineTo(-9, 1.2); ctx.lineTo(-11.5, 5); ctx.lineTo(-13.5, 5); ctx.lineTo(-12.5, 0);
    ctx.lineTo(-13.5, -5); ctx.lineTo(-11.5, -5); ctx.lineTo(-9, -1.2); ctx.lineTo(-3, -1.4); ctx.lineTo(-4.5, -11);
    ctx.lineTo(-1.5, -11); ctx.lineTo(2, -1.4); ctx.lineTo(5.5, -1.4); ctx.closePath();
    ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.stroke();
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }

  function fmt(v, d) { return (isFinite(v) ? v : 0).toFixed(d === undefined ? 1 : d); }

  // Small time-history chart: series = [{color, pts:[[t,v],...]}]
  function drawChart(cv, title, unit, T, lo, hi, series, tNow) {
    var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h, th = theme();
    var L = 38, R = 8, Tp = 18, B = 18;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
    var pw = w - L - R, ph = h - Tp - B;
    function X(t) { return L + pw * t / T; }
    function Y(v) { return Tp + ph * (1 - (clamp(v, lo, hi) - lo) / (hi - lo)); }
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
    ctx.font = '10px Inter, sans-serif'; ctx.fillStyle = th.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var i = 0; i <= 4; i++) {
      var v = lo + (hi - lo) * i / 4, yy = Y(v);
      ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - R, yy); ctx.stroke();
      ctx.fillText(Math.round(v), L - 5, yy);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var s = 0; s <= T; s += (T > 20 ? 10 : 5)) ctx.fillText(s + ' s', X(s), h - B + 4);
    ctx.textAlign = 'left'; ctx.fillStyle = th.text; ctx.font = '600 11px Inter, sans-serif';
    ctx.fillText(title + (unit ? ' (' + unit + ')' : ''), L, 3);
    if (lo < 0 && hi > 0) { ctx.strokeStyle = th.axis; ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(w - R, Y(0)); ctx.stroke(); }
    series.forEach(function (sr) {
      if (sr.pts.length < 2) return;
      ctx.strokeStyle = sr.color; ctx.lineWidth = 1.6; ctx.beginPath();
      for (var k = 0; k < sr.pts.length; k++) {
        var p = sr.pts[k]; if (k === 0) ctx.moveTo(X(p[0]), Y(p[1])); else ctx.lineTo(X(p[0]), Y(p[1]));
      }
      ctx.stroke();
    });
    if (tNow !== undefined) {
      ctx.strokeStyle = th.axis; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(X(tNow), Tp); ctx.lineTo(X(tNow), Tp + ph); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function legend(el, items) {
    el.innerHTML = items.map(function (it) {
      return '<span class="pf-leg"><i style="background:' + it.color + '"></i>' + it.label + '</span>';
    }).join('');
  }

  /* ════════════════════════════════════════════════════════════════
     1. PLANAR FIXED-TIME PATH FOLLOWING IN WIND  (AST 2024)
     ════════════════════════════════════════════════════════════════ */
  function initSim2D(root) {
    var cv = root.querySelector('canvas.pf-main');
    var cvR = root.querySelector('canvas.pf-chart-r');
    var cvX = root.querySelector('canvas.pf-chart-xi');
    var out = root.querySelector('.pf-readout');
    var leg = root.querySelector('.pf-legend');
    var btnPlay = root.querySelector('[data-act="play"]');
    var btnWind = root.querySelector('[data-act="wind"]');

    // Gains and limits from the paper's simulation section.
    var G = { M1: 20, N1: 5, a1: 1.01, b1: 0.9, M2: 50, N2: 25, a2: 1.01, b2: 0.9 };
    var VG_MIN = 10, VG_MAX = 50, WG_MAX = 4;   // ground speed (m/s), turn rate (rad/s)
    var WIND_V = 15, WIND_DIR = 135 * DEG;       // 15 m/s from the paper's scenario
    var H = 0.002;                               // integration step (s)

    var SCEN = {
      curvy: {
        label: 'Curvilinear path', T: 20, vr: 25, S0: [160, 170, 25],
        wr: function (t) { return Math.cbrt(2 * Math.sin(Math.PI / 2 * t)) - 1.2 * Math.cos(2 * Math.PI / 3 * t); },
        uavs: [[140, 80, 45], [180, 120, 90], [200, 100, 160]]
      },
      sturn: {
        label: 'Min-radius S-turn', T: 15, vr: 25, S0: [160, 170, 25],
        wr: function (t) { return t < 5 ? 0.5 : (t < 10 ? -0.5 : 0.5); },
        uavs: [[200, 100, 90], [140, 80, 45], [120, 230, -60]]
      },
      line: {
        label: 'Straight line', T: 14, vr: 25, S0: [160, 170, 25],
        wr: function () { return 0; },
        uavs: [[140, 80, 45], [180, 120, 90], [200, 100, 160]]
      }
    };

    var sc, path, uavs, t, hold, wind = true, particles = [], view = null;

    function buildPath(s) {
      var n = Math.round(s.T / H) + 1, xs = new Float64Array(n), ys = new Float64Array(n), ps = new Float64Array(n);
      var x = s.S0[0], y = s.S0[1], p = s.S0[2] * DEG;
      for (var i = 0; i < n; i++) {
        xs[i] = x; ys[i] = y; ps[i] = p;
        var tt = i * H;
        x += s.vr * Math.cos(p) * H; y += s.vr * Math.sin(p) * H; p += s.wr(tt) * H;
      }
      return { x: xs, y: ys, p: ps, n: n };
    }

    function makeUav(x, y, chiDeg, k, t0) {
      return { x: x, y: y, chi: chiDeg * DEG, color: COLORS[k % COLORS.length], name: 'C' + (k + 1),
        trail: [[x, y]], hist: [], cap: null, t0: t0 || 0, vg: 0, wg: 0, r: 0, xi: 0 };
    }

    function reset(key) {
      if (key) sc = SCEN[key];
      path = buildPath(sc);
      uavs = sc.uavs.map(function (u, k) { return makeUav(u[0], u[1], u[2], k); });
      t = 0; hold = 0; view = null;
      updateLegend();
    }

    function updateLegend() {
      var items = [{ color: AMBER, label: 'pseudo-target' }];
      uavs.forEach(function (u) { items.push({ color: u.color, label: u.name + (u.cap !== null ? ' · on path at ' + fmt(u.cap, 1) + ' s' : '') }); });
      legend(leg, items);
    }

    // Guidance law (Theorems 1–2): returns [v_g, omega_g, r, xi].
    function law(u, i) {
      var xr = path.x[i], yr = path.y[i], pr = path.p[i], vr = sc.vr;
      var dx = xr - u.x, dy = yr - u.y, r = Math.hypot(dx, dy);
      var th = Math.atan2(dy, dx), xi = wrap(th - u.chi);
      var F1 = G.M1 * Math.pow(r, G.a1) + G.N1 * Math.pow(r, G.b1);
      var c = Math.cos(xi);
      var vg = (vr * Math.cos(th - pr) + F1) / (Math.abs(c) < 1e-3 ? 1e-3 * sgn(c || 1) : c);
      var tx = Math.tan(clamp(xi, -1.55, 1.55));
      var wg = vr / r * (tx * Math.cos(th - pr) - Math.sin(th - pr)) + tx / r * F1 +
        (G.M2 * Math.pow(Math.abs(xi), G.a2) + G.N2 * Math.pow(Math.abs(xi), G.b2)) * sgn(xi);
      if (Math.abs(xi) > Math.PI / 2) wg = WG_MAX * sgn(xi);   // look angle beyond 90°: turn hard toward the LOS
      return [clamp(vg, VG_MIN, VG_MAX), clamp(wg, -WG_MAX, WG_MAX), r, xi];
    }

    // Wind triangle: airspeed and heading needed to fly ground velocity (v_g, chi).
    function airData(vg, chi) {
      if (!wind) return { va: vg, psia: chi };
      var wx = WIND_V * Math.cos(WIND_DIR), wy = WIND_V * Math.sin(WIND_DIR);
      var vax = vg * Math.cos(chi) - wx, vay = vg * Math.sin(chi) - wy;
      return { va: Math.hypot(vax, vay), psia: Math.atan2(vay, vax) };
    }

    function advance(dt) {
      if (t >= sc.T) { hold += dt; if (hold > 1.6) reset(); return; }
      var steps = Math.round(dt / H);
      for (var s = 0; s < steps && t < sc.T; s++) {
        var i = Math.min(path.n - 1, Math.round(t / H));
        uavs.forEach(function (u) {
          if (t < u.t0) return;
          if (u.cap !== null) {             // on the path: rides with the pseudo-target
            u.x = path.x[i]; u.y = path.y[i]; u.chi = path.p[i]; u.vg = sc.vr; u.wg = sc.wr(t); u.r = 0; u.xi = 0;
            return;
          }
          var L = law(u, i);
          u.vg = L[0]; u.wg = L[1]; u.r = L[2]; u.xi = L[3];
          if (u.r < 0.4) { u.cap = t; updateLegend(); return; }
          u.x += u.vg * Math.cos(u.chi) * H; u.y += u.vg * Math.sin(u.chi) * H; u.chi = wrap(u.chi + u.wg * H);
        });
        t += H;
        if (Math.round(t / H) % 25 === 0) {
          uavs.forEach(function (u) {
            if (t < u.t0) return;
            u.trail.push([u.x, u.y]);
            u.hist.push([t, u.r, u.xi / DEG]);
          });
        }
      }
    }

    // World → screen: the curvilinear path runs north, so rotate it to run left → right.
    function computeView(w, h) {
      var rot = sc === SCEN.curvy && w > h;   // lay the northbound path sideways on wide screens
      var pts = [];
      for (var i = 0; i < path.n; i += 50) pts.push([path.x[i], path.y[i]]);
      sc.uavs.forEach(function (u) { pts.push([u[0], u[1]]); });
      function R(p) { return rot ? [p[1], -p[0]] : [p[0], p[1]]; }
      var mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
      pts.forEach(function (p) { var q = R(p); mnx = Math.min(mnx, q[0]); mxx = Math.max(mxx, q[0]); mny = Math.min(mny, q[1]); mxy = Math.max(mxy, q[1]); });
      var pad = 28, s = Math.min((w - 2 * pad) / (mxx - mnx), (h - 2 * pad) / (mxy - mny));
      var ox = (w - s * (mxx - mnx)) / 2 - s * mnx, oy = (h + s * (mxy - mny)) / 2 + s * mny;
      view = {
        w: w, h: h, s: s,
        f: function (x, y) { var q = R([x, y]); return [ox + s * q[0], oy - s * q[1]]; },
        inv: function (px, py) { var X = (px - ox) / s, Y = (oy - py) / s; return rot ? [-Y, X] : [X, Y]; }
      };
      // world heading → canvas angle
      view.ang = function (a) { var p0 = view.f(0, 0), p1 = view.f(Math.cos(a), Math.sin(a)); return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]); };
      particles = [];
      for (var k = 0; k < 70; k++) particles.push([Math.random() * w, Math.random() * h, Math.random()]);
    }

    function draw(dt) {
      var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h, th = theme();
      if (!view || view.w !== w || view.h !== h) computeView(w, h);
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
      // light grid
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (var gy = 0; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

      // wind streaks
      if (wind) {
        var a = view.ang(WIND_DIR), sp = WIND_V * view.s * 1.0;
        ctx.strokeStyle = WIND; ctx.lineWidth = 1.2;
        particles.forEach(function (p) {
          p[0] += Math.cos(a) * sp * dt; p[1] += Math.sin(a) * sp * dt;
          if (p[0] < -20) p[0] += w + 40; if (p[0] > w + 20) p[0] -= w + 40;
          if (p[1] < -20) p[1] += h + 40; if (p[1] > h + 20) p[1] -= h + 40;
          ctx.globalAlpha = 0.18 + 0.25 * p[2];
          ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] - Math.cos(a) * 12, p[1] - Math.sin(a) * 12); ctx.stroke();
        });
        ctx.globalAlpha = 1;
        // wind badge
        var bx = w - 70, by = 34;
        ctx.fillStyle = th.halo; ctx.fillRect(bx - 52, by - 24, 116, 44);
        drawArrow(ctx, bx - 16 * Math.cos(a), by - 16 * Math.sin(a), bx + 16 * Math.cos(a), by + 16 * Math.sin(a), WIND, 2.2, 8);
        ctx.fillStyle = WIND; ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('wind', bx + 22, by - 7); ctx.fillText(WIND_V + ' m/s', bx + 22, by + 8);
      }

      // desired path
      ctx.strokeStyle = th.path; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
      ctx.beginPath();
      for (var i = 0; i < path.n; i += 20) { var q = view.f(path.x[i], path.y[i]); if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
      ctx.stroke(); ctx.setLineDash([]);

      var it = Math.min(path.n - 1, Math.round(t / H));
      var S = view.f(path.x[it], path.y[it]);

      // UAV trails, LOS lines, aircraft
      uavs.forEach(function (u) {
        if (t < u.t0) return;
        ctx.strokeStyle = u.color; ctx.lineWidth = 2.2; ctx.beginPath();
        u.trail.forEach(function (p, k) { var q = view.f(p[0], p[1]); if (k === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); });
        var qn = view.f(u.x, u.y); ctx.lineTo(qn[0], qn[1]); ctx.stroke();
        var st = view.f(u.trail[0][0], u.trail[0][1]);
        ctx.fillStyle = u.color; ctx.fillRect(st[0] - 4, st[1] - 4, 8, 8);
      });
      uavs.forEach(function (u) {
        if (t < u.t0 || u.cap !== null) return;
        var P = view.f(u.x, u.y);
        ctx.strokeStyle = u.color; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(S[0], S[1]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        // look-angle arc between course and LOS
        var ac = view.ang(u.chi), al = Math.atan2(S[1] - P[1], S[0] - P[0]);
        var d = wrap(al - ac);
        ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.6; ctx.beginPath();
        ctx.arc(P[0], P[1], 22, ac, ac + d, d < 0); ctx.stroke();
      });
      uavs.forEach(function (u) {
        if (t < u.t0) return;
        var P = view.f(u.x, u.y), ad = airData(u.vg, u.chi);
        var ac = view.ang(u.chi);
        if (u.cap === null) drawArrow(ctx, P[0], P[1], P[0] + 34 * Math.cos(ac), P[1] + 34 * Math.sin(ac), u.color, 1.6, 7);
        drawPlane(ctx, P[0], P[1], view.ang(ad.psia), 11, u.color, th.halo);
      });

      // pseudo-target
      var pulse = 7 + 2.5 * Math.sin(Date.now() / 220);
      ctx.fillStyle = 'rgba(217,119,6,0.18)'; ctx.beginPath(); ctx.arc(S[0], S[1], pulse + 6, 0, 7); ctx.fill();
      ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(S[0], S[1], 6.5, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(S[0], S[1], 2.6, 0, 7); ctx.stroke();

      // clock
      ctx.fillStyle = th.muted; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('t = ' + fmt(Math.min(t, sc.T), 1) + ' s', 12, 10);
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText('click anywhere to launch another UAV', 12, h - 20);
    }

    function readout() {
      var u = uavs[0];
      var ad = airData(u.vg, u.chi);
      out.innerHTML =
        '<div><span>range r</span><b>' + fmt(u.r, 1) + ' m</b></div>' +
        '<div><span>look angle ξ</span><b>' + fmt(u.xi / DEG, 1) + '°</b></div>' +
        '<div><span>ground speed v<sub>g</sub></span><b>' + fmt(u.vg, 1) + ' m/s</b></div>' +
        '<div><span>airspeed v<sub>a</sub></span><b>' + fmt(ad.va, 1) + ' m/s</b></div>' +
        '<div><span>turn rate ω<sub>g</sub></span><b>' + fmt(u.wg, 2) + ' rad/s</b></div>' +
        '<div><span>crab angle</span><b>' + fmt(wrap(ad.psia - u.chi) / DEG, 1) + '°</b></div>';
    }

    function charts() {
      var rmax = 10;
      uavs.forEach(function (u) { u.hist.forEach(function (p) { if (p[1] > rmax) rmax = p[1]; }); });
      rmax = Math.ceil(rmax / 20) * 20;
      drawChart(cvR, 'range r', 'm', sc.T, 0, rmax, uavs.map(function (u) { return { color: u.color, pts: u.hist.map(function (p) { return [p[0], p[1]]; }) }; }), t);
      drawChart(cvX, 'look angle ξ', 'deg', sc.T, -180, 180, uavs.map(function (u) { return { color: u.color, pts: u.hist.map(function (p) { return [p[0], p[2]]; }) }; }), t);
    }

    var frame = 0;
    var anim = animator(root, function (dt) {
      advance(dt * 0.6);   // slightly slower than real time so the capture is easy to follow
      draw(dt);
      if (frame++ % 3 === 0) { readout(); charts(); }
    });

    cv.addEventListener('click', function (e) {
      if (!view || t >= sc.T) return;
      var rc = cv.getBoundingClientRect();
      var p = view.inv(e.clientX - rc.left, e.clientY - rc.top);
      if (uavs.length >= 7) uavs.splice(3, 1);
      var it = Math.min(path.n - 1, Math.round(t / H));
      var away = Math.atan2(p[1] - path.y[it], p[0] - path.x[it]) / DEG + (Math.random() * 60 - 30);
      var u = makeUav(p[0], p[1], away, uavs.length, t);
      u.name = 'You' + (uavs.length - 2);
      uavs.push(u);
      updateLegend();
      anim.kick();
    });
    root.querySelectorAll('[data-scen]').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('[data-scen]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); reset(b.getAttribute('data-scen')); anim.kick();
      });
    });
    btnWind.addEventListener('click', function () { wind = !wind; btnWind.classList.toggle('on', wind); btnWind.textContent = wind ? 'Wind: on' : 'Wind: off'; });
    root.querySelector('[data-act="reset"]').addEventListener('click', function () { reset(); anim.kick(); });
    btnPlay.addEventListener('click', function () { anim.paused = !anim.paused; btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause'; anim.kick(); });
    btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause';

    reset('curvy');
  }

  /* ════════════════════════════════════════════════════════════════
     2. 3D FIXED-TIME PATH FOLLOWING  (AIAA JGCD 2024)
     ════════════════════════════════════════════════════════════════ */
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function unit(a) { var n = norm(a) || 1; return mul(a, 1 / n); }

  function initSim3D(root) {
    var cv = root.querySelector('canvas.pf-main');
    var cvR = root.querySelector('canvas.pf-chart-r');
    var cvS = root.querySelector('canvas.pf-chart-xi');
    var out = root.querySelector('.pf-readout');
    var leg = root.querySelector('.pf-legend');
    var btnPlay = root.querySelector('[data-act="play"]');

    // Direct port of the paper's simulation code (engagement kinematics, Theorems 1–3,
    // allocation with Υ_y = Υ_z = 1, |V_U| ≤ 40 m/s, |ω_U^{y,z}| ≤ 3 rad/s). Integrated
    // once at h = 1 ms when a scenario is selected, then played back.
    var G = { M1: 0.5, N1: 0.5, a1: 1.01, b1: 0.99, M2: 100, N2: 100, a2: 1.01, b2: 0.99 };
    var VMAX = 40, WMAX = 3, HI = 0.001, H = 0.01;   // integration step, playback sample

    var SCEN = {
      helix: { T: 30, VT: 25, T0: [50, 50, 50], hd: [10, 10],
        w: function (t) { return [Math.sin(t), Math.cos(t)]; },
        uavs: [[0, 0, 0, 45, 45]] },
      line: { T: 20, VT: 25, T0: [50, 50, 50], hd: [10, 10],
        w: function () { return [0, 0]; },
        uavs: [[0, 0, 0, 45, 90], [0, 200, 0, 30, 60], [0, 0, 300, 60, -45], [10, 150, 120, 145, 135]] }
    };

    var sc, path, runs, uavs, t, hold, yaw = -2.2, pitch = 0.42, drag = null, lastInteract = -1e9, center, radius;

    // R = Rz(ps)·Ry(th) with the paper's sign convention (pitch up positive); returns R·[1,0,0] etc.
    function R(ps, th) {
      var cp = Math.cos(ps), sp = Math.sin(ps), ct = Math.cos(th), st = Math.sin(th);
      return [[cp * ct, -sp, -cp * st], [sp * ct, cp, -sp * st], [st, 0, ct]];
    }
    function mv(M, v) { return [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]]; }
    function mtv(M, v) { return [M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2], M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2], M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2]]; }

    function simulate(s, U0) {
      var xu = U0[0], yu = U0[1], zu = U0[2], psu = U0[3] * DEG, thu = U0[4] * DEG;
      var xt = s.T0[0], yt = s.T0[1], zt = s.T0[2], VT = s.VT;
      var th = Math.atan2(zt - zu, Math.hypot(xt - xu, yt - yu)), ps = Math.atan2(yt - yu, xt - xu);
      var vlos = mtv(R(ps, th), mv(R(s.hd[0] * DEG, s.hd[1] * DEG), [VT, 0, 0]));
      var tht = Math.asin(vlos[2] / VT), pst = Math.atan2(vlos[1], vlos[0]);
      var out = { U: [], Tg: [], D: [], r: [], sig: [], V: [], cap: null };
      var every = Math.round(H / HI), n = Math.round(s.T / HI);
      for (var k = 0; k <= n; k++) {
        var tt = k * HI, w = s.w(tt);
        var dx = xt - xu, dy = yt - yu, dz = zt - zu, r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        th = Math.atan2(dz, Math.hypot(dx, dy)); ps = Math.atan2(dy, dx);
        var su = Math.acos(clamp(Math.cos(psu) * Math.cos(thu), -1, 1));
        var vu = (VT * Math.cos(tht) * Math.cos(pst) + (G.M1 * Math.pow(r, G.a1) + G.N1 * Math.pow(r, G.b1)) * Math.tanh(r)) / (Math.cos(thu) * Math.cos(psu));
        var Sig = Math.sin(su) * (-(vu * Math.sin(su)) / r + (VT / r * Math.sin(su)) * (Math.cos(tht) * Math.sin(pst) * Math.cos(thu) * Math.sin(psu) + Math.sin(thu) * Math.sin(tht))
          - (G.M2 * Math.pow(su, G.a2) + G.N2 * Math.pow(su, G.b2)) * Math.tanh(1e5 * su));
        var Dn = Math.pow(Math.sin(psu), 2) + Math.pow(Math.sin(thu) * Math.cos(psu), 2);
        var wuy = Dn > 1e-12 ? Math.sin(psu) * Sig / Dn : 0, wuz = Dn > 1e-12 ? Math.sin(thu) * Math.cos(psu) * Sig / Dn : 0;
        vu = clamp(vu, -VMAX, VMAX); wuy = clamp(wuy, -WMAX, WMAX); wuz = clamp(wuz, -WMAX, WMAX);
        var B = R(ps, th);
        var vU = mv(B, mv(R(psu, thu), [vu, 0, 0])), vT = mv(B, mv(R(pst, tht), [VT, 0, 0]));
        if (k % every === 0) {
          out.U.push([xu, yu, zu]); out.Tg.push([xt, yt, zt]); out.D.push(unit(vU));
          out.r.push(r); out.sig.push(su / DEG); out.V.push(vu);
        }
        if (out.cap === null && r < 0.5) out.cap = tt;
        var thd = (VT * Math.sin(tht) - vu * Math.sin(thu)) / r;
        var psd = (VT * Math.cos(tht) * Math.sin(pst) - vu * Math.cos(thu) * Math.sin(psu)) / (r * Math.cos(th));
        var dpsu = wuy / Math.cos(thu) + psd * Math.tan(thu) * Math.cos(psu) * Math.sin(th) - psd * Math.cos(th) - thd * Math.tan(thu) * Math.sin(psu);
        var dthu = wuz - psd * Math.sin(th) * Math.sin(psu) - thd * Math.cos(psu);
        var dpst = w[0] / Math.cos(tht) + psd * Math.tan(tht) * Math.cos(pst) * Math.sin(th) - psd * Math.cos(th) - thd * Math.tan(tht) * Math.sin(pst);
        var dtht = w[1] - psd * Math.sin(th) * Math.sin(pst) - thd * Math.cos(pst);
        xu += HI * vU[0]; yu += HI * vU[1]; zu += HI * vU[2]; psu += HI * dpsu; thu += HI * dthu;
        xt += HI * vT[0]; yt += HI * vT[1]; zt += HI * vT[2]; pst += HI * dpst; tht += HI * dtht;
      }
      return out;
    }

    function reset(key) {
      if (key) { sc = SCEN[key]; runs = sc.uavs.map(function (u) { return simulate(sc, u); }); }
      path = { P: runs[0].Tg, n: runs[0].Tg.length };
      uavs = runs.map(function (rn, k) {
        return { run: rn, q: rn.U[0], u: rn.D[0], color: sc === SCEN.helix ? '#c026d3' : COLORS[(k + 2) % COLORS.length], name: 'S' + (k + 1),
          trail: [rn.U[0]], hist: [], cap: null, V: 0, r: 0, sig: 0 };
      });
      var mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      var pts = path.P.filter(function (_, i) { return i % 20 === 0; }).concat(sc.uavs.map(function (u) { return [u[0], u[1], u[2]]; }));
      pts.forEach(function (p) { for (var k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } });
      center = mul(add(mn, mx), 0.5); center.zmin = mn[2];
      radius = 0.5 * norm(sub(mx, mn));
      t = 0; hold = 0;
      legend(leg, [{ color: AMBER, label: 'pseudo-target' }].concat(uavs.map(function (u) { return { color: u.color, label: u.name + (sc === SCEN.line ? '' : ' (UAV)') }; })));
    }

    function advance(dt) {
      if (t >= sc.T) { hold += dt; if (hold > 1.6) reset(); return; }
      t = Math.min(sc.T, t + dt);
      var i = Math.min(path.n - 1, Math.floor(t / H));
      uavs.forEach(function (u) {
        var rn = u.run;
        u.q = rn.U[i]; u.u = rn.D[i]; u.r = rn.r[i]; u.sig = rn.sig[i]; u.V = rn.V[i];
        u.cap = rn.cap !== null && rn.cap <= t ? rn.cap : null;
        u.trail = rn.U.slice(0, i + 1);
        var hs = [];
        for (var k = 0; k <= i; k += 5) hs.push([k * H, rn.r[k], rn.sig[k]]);
        u.hist = hs;
      });
    }

    function draw(dt) {
      var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h, th = theme();
      if (!drag && performance.now() - lastInteract > 2500 && !reduceMotion) yaw += dt * 0.18;
      var s = 0.92 * Math.min(w, h) / (2 * radius) * 1.05;
      var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      function P(p) {
        var dx = p[0] - center[0], dy = p[1] - center[1], dz = p[2] - center[2];
        var x1 = dx * cy - dy * sy, y1 = dx * sy + dy * cy;
        return [w / 2 + s * x1, h / 2 - s * (dz * cp + y1 * sp)];
      }
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);

      // ground grid
      var z0 = center.zmin - 5, g = Math.ceil(radius / 50) * 50, step = g / 4;
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      for (var k = -4; k <= 4; k++) {
        var a1 = P([center[0] + k * step, center[1] - g, z0]), a2 = P([center[0] + k * step, center[1] + g, z0]);
        var b1 = P([center[0] - g, center[1] + k * step, z0]), b2 = P([center[0] + g, center[1] + k * step, z0]);
        ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]); ctx.moveTo(b1[0], b1[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
      }
      // axes triad
      var O = [center[0] - g, center[1] - g, z0], al = g * 0.35;
      [['X', [al, 0, 0]], ['Y', [0, al, 0]], ['Z', [0, 0, al]]].forEach(function (ax) {
        var a = P(O), b = P(add(O, ax[1]));
        drawArrow(ctx, a[0], a[1], b[0], b[1], th.axis, 1.2, 6);
        ctx.fillStyle = th.muted; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(ax[0], b[0] + (b[0] - a[0]) * 0.18, b[1] + (b[1] - a[1]) * 0.18);
      });

      function poly(pts, color, width, dash, alpha) {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha || 1; ctx.setLineDash(dash || []);
        ctx.beginPath();
        pts.forEach(function (p, k) { var q = P(p); if (k === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); });
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      var full = [];
      for (var i = 0; i < path.n; i += 4) full.push(path.P[i]);
      // shadows on the ground
      poly(full.map(function (p) { return [p[0], p[1], z0]; }), th.path, 1, [], 0.35);
      uavs.forEach(function (u) { poly(u.trail.map(function (p) { return [p[0], p[1], z0]; }), u.color, 1, [], 0.25); });
      // path and trails
      poly(full, th.path, 1.8, [6, 5]);
      uavs.forEach(function (u) { poly(u.trail.concat([u.q]), u.color, 2.2); });

      var it = Math.min(path.n - 1, Math.round(t / H));
      var S = P(path.P[it]);
      uavs.forEach(function (u) {
        var q = P(u.q), st = P(u.trail[0]);
        ctx.fillStyle = u.color; ctx.fillRect(st[0] - 4, st[1] - 4, 8, 8);
        if (u.cap === null) {
          ctx.strokeStyle = u.color; ctx.globalAlpha = 0.55; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(S[0], S[1]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        // drop line
        var gq = P([u.q[0], u.q[1], z0]);
        ctx.strokeStyle = th.axis; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(gq[0], gq[1]); ctx.stroke();
        var hq = P(add(u.q, mul(u.u, 6)));
        drawPlane(ctx, q[0], q[1], Math.atan2(hq[1] - q[1], hq[0] - q[0]), 9, u.color, th.halo);
      });
      var pulse = 6 + 2 * Math.sin(Date.now() / 220);
      ctx.fillStyle = 'rgba(217,119,6,0.18)'; ctx.beginPath(); ctx.arc(S[0], S[1], pulse + 5, 0, 7); ctx.fill();
      ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(S[0], S[1], 5.5, 0, 7); ctx.fill();

      ctx.fillStyle = th.muted; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('t = ' + fmt(Math.min(t, sc.T), 1) + ' s', 12, 10);
      ctx.font = '11px Inter, sans-serif'; ctx.fillText('drag to rotate the view', 12, h - 20);
    }

    function readout() {
      var u = uavs[0];
      out.innerHTML =
        '<div><span>range r</span><b>' + fmt(u.r, 1) + ' m</b></div>' +
        '<div><span>effective heading σ<sub>U</sub></span><b>' + fmt(u.sig, 1) + '°</b></div>' +
        '<div><span>speed V<sub>U</sub></span><b>' + fmt(u.V, 1) + ' m/s</b></div>' +
        '<div><span>status</span><b>' + (u.cap !== null ? 'on path at ' + fmt(u.cap, 1) + ' s' : 'converging') + '</b></div>';
    }
    function charts() {
      var rmax = 10;
      uavs.forEach(function (u) { u.hist.forEach(function (p) { if (p[1] > rmax) rmax = p[1]; }); });
      rmax = Math.ceil(rmax / 50) * 50;
      drawChart(cvR, 'range r', 'm', sc.T, 0, rmax, uavs.map(function (u) { return { color: u.color, pts: u.hist.map(function (p) { return [p[0], p[1]]; }) }; }), t);
      drawChart(cvS, 'effective heading σ_U', 'deg', sc.T, 0, 180, uavs.map(function (u) { return { color: u.color, pts: u.hist.map(function (p) { return [p[0], p[2]]; }) }; }), t);
    }

    var frame = 0;
    var anim = animator(root, function (dt) { advance(dt); draw(dt); if (frame++ % 3 === 0) { readout(); charts(); } });

    function down(x, y) { drag = [x, y, yaw, pitch]; }
    function move(x, y) {
      if (!drag) return;
      yaw = drag[2] - (x - drag[0]) * 0.008;
      pitch = clamp(drag[3] + (y - drag[1]) * 0.006, 0.05, 1.45);
      lastInteract = performance.now(); anim.kick();
    }
    cv.addEventListener('mousedown', function (e) { down(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', function () { if (drag) lastInteract = performance.now(); drag = null; });
    cv.addEventListener('touchstart', function (e) { var p = e.touches[0]; down(p.clientX, p.clientY); }, { passive: true });
    cv.addEventListener('touchmove', function (e) { var p = e.touches[0]; move(p.clientX, p.clientY); e.preventDefault(); }, { passive: false });
    cv.addEventListener('touchend', function () { drag = null; });

    root.querySelectorAll('[data-scen]').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('[data-scen]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); reset(b.getAttribute('data-scen')); anim.kick();
      });
    });
    root.querySelector('[data-act="reset"]').addEventListener('click', function () { reset(); anim.kick(); });
    btnPlay.addEventListener('click', function () { anim.paused = !anim.paused; btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause'; anim.kick(); });
    btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause';
    reset('helix');
  }

  /* ════════════════════════════════════════════════════════════════
     3. INPUT-SATURATION MODEL  (bounded-input designs)
        u̇ = K1[1 − (u/u_max)^γ] u_c − K1 K2 u,   V_U = u + u_max + V0
     ════════════════════════════════════════════════════════════════ */
  function initSat(root) {
    var cv = root.querySelector('canvas');
    var slider = root.querySelector('input[type=range]');
    var label = root.querySelector('.pf-sat-gain');
    var V0 = 3, VMAX = 25, UMAX = (VMAX - V0) / 2, K1 = 2, K2 = 0.5, GAM = 2, H = 0.001, WIN = 12;
    var u = 0, t = 0, hist = [];
    function command(tt, A) {   // an aggressive, illustrative speed command (m/s, shifted)
      return A * (Math.sin(0.9 * tt) + 0.7 * Math.sin(2.7 * tt + 1) + (Math.sin(0.35 * tt) > 0.3 ? 1.2 : -0.6));
    }
    function step(dt) {
      var A = +slider.value;
      var n = Math.round(dt / H);
      for (var i = 0; i < n; i++) {
        var uc = command(t, A);
        u += H * (K1 * (1 - Math.pow(u / UMAX, GAM)) * uc - K1 * K2 * u);
        t += H;
        if (i % 20 === 0) hist.push([t, uc + UMAX + V0, u + UMAX + V0]);
      }
      while (hist.length && hist[0][0] < t - WIN) hist.shift();
      label.textContent = A + '×';
      // draw
      var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h, th = theme();
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
      var L = 44, R = 12, T = 22, B = 22, lo = -10, hi = 40;
      function X(tt) { return L + (w - L - R) * (tt - (t - WIN)) / WIN; }
      function Y(v) { return T + (h - T - B) * (1 - (v - lo) / (hi - lo)); }
      // admissible band
      ctx.fillStyle = isDark() ? 'rgba(96,165,250,0.10)' : 'rgba(37,99,235,0.07)';
      ctx.fillRect(L, Y(VMAX), w - L - R, Y(V0) - Y(VMAX));
      ctx.strokeStyle = isDark() ? '#60a5fa' : '#2563eb'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
      [V0, VMAX].forEach(function (v) { ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(w - R, Y(v)); ctx.stroke(); });
      ctx.setLineDash([]);
      ctx.font = '10px Inter, sans-serif'; ctx.fillStyle = th.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      [lo, 0, V0, 10, 20, VMAX, hi].forEach(function (v) { ctx.fillText(v, L - 6, Y(v)); });
      ctx.textAlign = 'left'; ctx.fillStyle = isDark() ? '#93c5fd' : '#2563eb';
      ctx.fillText('V_max = 25 m/s', L + 6, Y(VMAX) - 8); ctx.fillText('V_0 = 3 m/s', L + 6, Y(V0) + 9);
      ctx.save(); ctx.beginPath(); ctx.rect(L, T, w - L - R, h - T - B); ctx.clip();
      ctx.strokeStyle = th.muted; ctx.lineWidth = 1.3; ctx.setLineDash([3, 3]); ctx.beginPath();
      hist.forEach(function (p, k) { if (k === 0) ctx.moveTo(X(p[0]), Y(p[1])); else ctx.lineTo(X(p[0]), Y(p[1])); });
      ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#c026d3'; ctx.lineWidth = 2.4; ctx.beginPath();
      hist.forEach(function (p, k) { if (k === 0) ctx.moveTo(X(p[0]), Y(p[2])); else ctx.lineTo(X(p[0]), Y(p[2])); });
      ctx.stroke(); ctx.restore();
      ctx.fillStyle = th.text; ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('speed (m/s)', 6, 14);
      ctx.fillStyle = th.muted; ctx.font = '10px Inter, sans-serif'; ctx.textBaseline = 'top';
      ctx.fillText('time →', w - R - 40, h - B + 6);
    }
    var anim = animator(root, step);
    slider.addEventListener('input', function () { anim.kick(); });
    var btn = root.querySelector('[data-act="play"]');
    if (btn) {
      btn.textContent = anim.paused ? '▶ Play' : '❚❚ Pause';
      btn.addEventListener('click', function () { anim.paused = !anim.paused; btn.textContent = anim.paused ? '▶ Play' : '❚❚ Pause'; anim.kick(); });
    }
  }

  /* ════════════════════════════════════════════════════════════════
     4. CROSS-TRACK GUIDANCE: terminal sliding mode (AIAA GNC 2023) vs
        nested saturation (ASCC 2026 / AST 2026), same paths and starts.
     ════════════════════════════════════════════════════════════════ */
  function initCT(root) {
    var cv = root.querySelector('canvas.pf-main');
    var cvA = root.querySelector('canvas.pf-chart-r');
    var cvP = root.querySelector('canvas.pf-chart-xi');
    var out = root.querySelector('.pf-readout');
    var leg = root.querySelector('.pf-legend');
    var btnPlay = root.querySelector('[data-act="play"]');
    var V = 10, H = 0.002, AMAX = 10, REC = 0.02;
    var CC = ['#16a34a', '#2563eb', '#c026d3', '#0891b2'];

    var PATHS = {
      line: { T: 14, starts: [[20, 10, 45], [10, 30, 80], [15, -15, 135], [0, 40, 60]],
        geo: function (x, y) {
          var pd = Math.PI / 4, d = -x * Math.sin(pd) + y * Math.cos(pd);
          return { d: d, psid: pd, foot: [x + d * Math.sin(pd), y - d * Math.cos(pd)], rate: function () { return 0; } };
        },
        sample: function () { var p = []; for (var s = -400; s <= 400; s += 4) p.push([s * Math.SQRT1_2, s * Math.SQRT1_2]); return p; } },
      circle: { T: 20, starts: [[20, 20, 60], [10, 10, 45], [30, 20, 100], [-25, -40, 130]],
        geo: function (x, y) {
          var Rp = Math.hypot(x, y), R = 20;
          return { d: Rp - R, psid: Math.atan2(-x, y), foot: [x * R / Rp, y * R / Rp],
            rate: function (xd, yd) { return (x * yd - y * xd) / (Rp * Rp); } };
        },
        sample: function () { var p = []; for (var a = 0; a <= 2 * Math.PI + 0.01; a += 0.03) p.push([20 * Math.cos(a), 20 * Math.sin(a)]); return p; } },
      sine: { T: 22, starts: [[10, -10, 60], [5, 15, 30], [-15, 5, 45], [15, 5, 80]],
        geo: function (x, y) {
          var A = 10, w = 2 * Math.PI / 100, s = A * w * Math.cos(w * x), n = Math.sqrt(1 + s * s);
          var d = (y - A * Math.sin(w * x)) / n, pd = Math.atan(s);
          return { d: d, psid: pd, foot: [x + d * Math.sin(pd), y - d * Math.cos(pd)],
            rate: function (xd) { return -A * w * w * Math.sin(w * x) * xd / (n * n); } };
        },
        sample: function () { var p = []; for (var x = -60; x <= 400; x += 2) p.push([x, 10 * Math.sin(2 * Math.PI / 100 * x)]); return p; } }
    };
    function sat(s, M) { return s > M ? M : (s < -M ? -M : s); }
    function spow(v, e) { return Math.pow(Math.abs(v), e) * sgn(v); }

    // Terminal sliding mode (Kumar, Kumar & Sinha, AIAA GNC 2023), gains from the paper's simulation code.
    function amSMC(g, psi) {
      var circ = key === 'circle', p = 15, q = 13, beta = circ ? 5 : 2, eta = circ ? 50 : 20, c = circ ? 5 : 1;
      var z = psi - g.psid, dd = V * Math.sin(z);
      var s = g.d + spow(dd, p / q) / beta;
      var am = (-1 / Math.cos(z)) * (beta * (p / q) * spow(dd, 2 - p / q) + eta * Math.tanh(c * s));
      return sat(am, 50);
    }
    // Nested saturation (Kathiriya, Kumar & Kumar, ASCC 2026 / AST 2026), k1 = k2 = 1, M2' = 10, M1 = M2/2.1.
    function amNS(g, psi, rate) {
      // at |ψ−ψd| = 90° the ratio u/cos stays finite (M2 ∝ |cos|), so only guard against an exact zero
      var k1 = 1, k2 = 1, z = psi - g.psid, cz = Math.cos(z), d1 = g.d, d2 = V * Math.sin(z);
      if (Math.abs(cz) < 1e-9) cz = cz < 0 ? -1e-9 : 1e-9;
      var h1 = k1 * k2 * d1 + k2 * d2, h2 = k1 * d2;
      var M2 = Math.abs((AMAX - V * Math.abs(rate)) * cz), M1 = M2 / 2.1;
      var u = -sat(h2 + sat(h1, M1), M2);
      return (u + V * rate * cz) / cz;
    }

    function simulate() {
      var P = PATHS[key], res = [];
      P.starts.forEach(function (st) {
        var x = st[0], y = st[1], psi = st[2] * DEG, n = Math.round(P.T / H), every = Math.round(REC / H);
        var rec = { xy: [], foot: [], d: [], dd: [], am: [], psi: [] };
        for (var k = 0; k <= n; k++) {
          var g = P.geo(x, y), xd = V * Math.cos(psi), yd = V * Math.sin(psi), rate = g.rate(xd, yd);
          var am = law === 'smc' ? amSMC(g, psi) : amNS(g, psi, rate);
          if (k % every === 0) {
            rec.xy.push([x, y]); rec.foot.push(g.foot); rec.d.push(g.d); rec.dd.push(V * Math.sin(psi - g.psid));
            rec.am.push(am); rec.psi.push(psi);
          }
          x += xd * H; y += yd * H; psi += am / V * H;
        }
        res.push(rec);
      });
      return res;
    }

    var key = 'line', law = 'ns', runs, t = 0, hold = 0, view = null, pathPts;
    function reset() {
      runs = simulate(); t = 0; hold = 0; view = null;
      pathPts = PATHS[key].sample();
      legend(leg, [{ color: AMBER, label: 'closest point' }, { color: '#dc2626', label: 'cross-track error d' }].concat(
        runs.map(function (_, k) { return { color: CC[k], label: 'Case ' + (k + 1) }; })));
    }

    function computeView(w, h) {
      var mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
      runs.forEach(function (r) { r.xy.forEach(function (p) { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); }); });
      if (key === 'circle') { mnx = Math.min(mnx, -22); mxx = Math.max(mxx, 22); mny = Math.min(mny, -22); mxy = Math.max(mxy, 22); }
      var pad = 26, s = Math.min((w - 2 * pad) / (mxx - mnx), (h - 2 * pad) / (mxy - mny));
      var ox = (w - s * (mxx - mnx)) / 2 - s * mnx, oy = (h + s * (mxy - mny)) / 2 + s * mny;
      view = { w: w, h: h, f: function (x, y) { return [ox + s * x, oy - s * y]; } };
    }

    function idx() { return Math.min(runs[0].xy.length - 1, Math.floor(t / REC)); }

    function draw() {
      var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h, th = theme();
      if (!view || view.w !== w || view.h !== h) computeView(w, h);
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (var gy = 0; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      ctx.strokeStyle = th.path; ctx.lineWidth = 2.2; ctx.setLineDash([7, 6]); ctx.beginPath();
      pathPts.forEach(function (p, k) { var q = view.f(p[0], p[1]); if (k === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); });
      ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      var i = idx();
      runs.forEach(function (r, k) {
        ctx.strokeStyle = CC[k]; ctx.lineWidth = 2.2; ctx.beginPath();
        for (var j = 0; j <= i; j++) { var q = view.f(r.xy[j][0], r.xy[j][1]); if (j === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
        ctx.stroke();
        var s0 = view.f(r.xy[0][0], r.xy[0][1]); ctx.fillStyle = CC[k]; ctx.fillRect(s0[0] - 4, s0[1] - 4, 8, 8);
      });
      runs.forEach(function (r, k) {
        var P = view.f(r.xy[i][0], r.xy[i][1]), F = view.f(r.foot[i][0], r.foot[i][1]);
        if (Math.abs(r.d[i]) > 0.3) {
          ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(F[0], F[1]); ctx.stroke();
          ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(F[0], F[1], 4, 0, 7); ctx.fill();
        }
        var H2 = view.f(r.xy[i][0] + Math.cos(r.psi[i]), r.xy[i][1] + Math.sin(r.psi[i]));
        drawPlane(ctx, P[0], P[1], Math.atan2(H2[1] - P[1], H2[0] - P[0]), 10, CC[k], th.halo);
      });
      ctx.fillStyle = th.muted; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('t = ' + fmt(i * REC, 1) + ' s', 12, 10);
    }

    function charts() {
      var T = PATHS[key].T, i = idx(), th = theme();
      var series = runs.map(function (r, k) {
        var pts = []; for (var j = 0; j <= i; j += 3) pts.push([j * REC, r.am[j]]); return { color: CC[k], pts: pts };
      });
      drawChart(cvA, 'lateral acceleration a_m (band: ±10)', 'm/s²', T, -30, 30, series, i * REC);
      var fa = fitCanvas(cvA), ca = fa.ctx, ph = fa.h - 18 - 18;
      function Ya(v) { return 18 + ph * (1 - (v + 30) / 60); }
      ca.fillStyle = isDark() ? 'rgba(96,165,250,0.12)' : 'rgba(37,99,235,0.08)';
      ca.fillRect(38, Ya(AMAX), fa.w - 46, Ya(-AMAX) - Ya(AMAX));

      // phase plane d vs d-dot
      var fp = fitCanvas(cvP), c2 = fp.ctx, w = fp.w, h = fp.h;
      c2.fillStyle = th.bg; c2.fillRect(0, 0, w, h);
      var dm = 1; runs.forEach(function (r) { r.d.forEach(function (v) { dm = Math.max(dm, Math.abs(v)); }); });
      dm = Math.ceil(dm / 10) * 10;
      var Lp = 38, Rp = 8, Tq = 18, Bq = 18, pw = w - Lp - Rp, pq = h - Tq - Bq;
      function X2(v) { return Lp + pw * (v + dm) / (2 * dm); }
      function Y2(v) { return Tq + pq * (1 - (v + V) / (2 * V)); }
      c2.strokeStyle = th.axis; c2.lineWidth = 1;
      c2.beginPath(); c2.moveTo(X2(0), Tq); c2.lineTo(X2(0), Tq + pq); c2.moveTo(Lp, Y2(0)); c2.lineTo(w - Rp, Y2(0)); c2.stroke();
      c2.font = '10px Inter, sans-serif'; c2.fillStyle = th.muted; c2.textAlign = 'center'; c2.textBaseline = 'top';
      c2.fillText(-dm, X2(-dm) + 10, h - Bq + 4); c2.fillText(dm, X2(dm) - 10, h - Bq + 4); c2.fillText('d (m)', X2(0) + 22, h - Bq + 4);
      c2.textAlign = 'right'; c2.textBaseline = 'middle';
      c2.fillText(V, Lp - 5, Y2(V)); c2.fillText(-V, Lp - 5, Y2(-V)); c2.fillText(0, Lp - 5, Y2(0));
      c2.textAlign = 'left'; c2.textBaseline = 'top'; c2.fillStyle = th.text; c2.font = '600 11px Inter, sans-serif';
      c2.fillText('phase plane: ḋ (m/s) vs d', Lp, 3);
      runs.forEach(function (r, k) {
        c2.strokeStyle = CC[k]; c2.lineWidth = 1.6; c2.beginPath();
        for (var j = 0; j <= i; j += 2) { var X = X2(r.d[j]), Yv = Y2(r.dd[j]); if (j === 0) c2.moveTo(X, Yv); else c2.lineTo(X, Yv); }
        c2.stroke();
        c2.fillStyle = CC[k]; c2.beginPath(); c2.arc(X2(r.d[i]), Y2(r.dd[i]), 3, 0, 7); c2.fill();
      });

      var peak = 0, dmax = 0;
      runs.forEach(function (r) { for (var j = 0; j <= i; j++) peak = Math.max(peak, Math.abs(r.am[j])); dmax = Math.max(dmax, Math.abs(r.d[i])); });
      out.innerHTML =
        '<div><span>law</span><b>' + (law === 'ns' ? 'nested saturation' : 'terminal sliding mode') + '</b></div>' +
        '<div><span>largest |d| now</span><b>' + fmt(dmax, 1) + ' m</b></div>' +
        '<div><span>peak |a<sub>m</sub>| so far</span><b style="color:' + (peak > AMAX + 0.05 ? '#dc2626' : '#16a34a') + '">' + fmt(peak, 1) + ' m/s²</b></div>' +
        '<div><span>bound a<sub>max</sub></span><b>' + AMAX + ' m/s²</b></div>';
    }

    var frame = 0;
    var anim = animator(root, function (dt) {
      if (t >= PATHS[key].T) { hold += dt; if (hold > 1.6) { t = 0; hold = 0; } } else t += dt;
      draw(); if (frame++ % 3 === 0) charts();
    });
    root.querySelectorAll('[data-scen]').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('[data-scen]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); key = b.getAttribute('data-scen'); reset(); anim.kick();
      });
    });
    root.querySelectorAll('[data-law]').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('[data-law]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); law = b.getAttribute('data-law'); reset(); anim.kick();
      });
    });
    root.querySelector('[data-act="reset"]').addEventListener('click', function () { t = 0; hold = 0; anim.kick(); });
    btnPlay.addEventListener('click', function () { anim.paused = !anim.paused; btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause'; anim.kick(); });
    btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause';
    reset();
  }

  /* ════════════════════════════════════════════════════════════════
     5. PURSUER–EVADER–DEFENDER ENGAGEMENT (Kumar, Kumar & Sinha, JAIS)
        Direct port of the paper's simulation code: maneuver-level (MLC) and
        information-level (ILC) cooperation, delayed a_E, three pursuer laws.
     ════════════════════════════════════════════════════════════════ */
  var CE = '#2563eb', CP = '#dc2626', CD = '#16a34a';
  var PE_V = { D: 200, P: 200, E: 100 };

  function drawMissile(ctx, x, y, a, size, color, halo) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(size / 10, size / 10);
    ctx.beginPath();
    ctx.moveTo(12, 0); ctx.lineTo(4, 2.2); ctx.lineTo(-8, 2.2); ctx.lineTo(-12, 6); ctx.lineTo(-12, -6);
    ctx.lineTo(-8, -2.2); ctx.lineTo(4, -2.2); ctx.closePath();
    ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.stroke(); ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }
  function drawBurst(ctx, x, y, k) {
    for (var i = 0; i < 10; i++) {
      var a = i / 10 * 2 * Math.PI, r0 = 4 + 10 * k, r1 = 8 + 22 * k;
      ctx.strokeStyle = i % 2 ? '#f59e0b' : '#dc2626'; ctx.lineWidth = 2; ctx.globalAlpha = Math.max(0, 1 - k * 0.7);
      ctx.beginPath(); ctx.moveTo(x + r0 * Math.cos(a), y + r0 * Math.sin(a)); ctx.lineTo(x + r1 * Math.cos(a), y + r1 * Math.sin(a)); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // The paper's simulation scenarios (Section V), with the initial conditions and gains of the
  // corresponding MATLAB scripts. Each scenario lists the cases plotted together in one figure.
  var PE_BASE = {
    mlc: { rEP: 5000, lEP: 0, rED: 500, lED: -45, gE: 45, gD: 30, gP: 180, vE: 100, chi: 180, plaw: 'png', N: 5, tg: 10,
           aP: 20, aD: 20, aE: 10, k1: 6, k2: 3, t1: 3, ts: 6, K: 5, marg: 0.2 },
    ilc: { rEP: 5000, lEP: 0, rED: 500, lED: 45, gE: 45, gD: 0, gP: 180, vE: 100, chi: 180, plaw: 'png', N: 3, tg: 10,
           aP: 20, aD: 20, aE: 10, k1: 3, k2: 3, t1: 5, ts: 9, K: 1, marg: 0.1, t2: 4, k3: 3, K1: 1, tau: 0 }
  };
  var PE_SCN = {
    mlc: [
      { label: 'Different χ*', fig: 'MLC_diff_chi',
        desc: 'Pursuer at 5000 m (LOS 0°), defender at 500 m (LOS −45°); headings γ<sub>E</sub> = 45°, γ<sub>D</sub> = 30°, γ<sub>P</sub> = 180°, so χ(0) = 229°. The pursuer uses PN with 𝒩 = 5.',
        cases: [{ label: 'χ* = 150°', chi: 150 }, { label: 'χ* = 180°', chi: 180 }, { label: 'χ* = 200°', chi: 200 }], on: 1 },
      { label: 'Pursuer guidance', base: { tg: 20 },
        desc: 'Same geometry with χ* = 180°. PNG with 𝒩 = 5, pure pursuit a<sub>P</sub> = v<sub>P</sub>λ̇<sub>EP</sub> − 0.5(γ<sub>P</sub> − λ<sub>EP</sub>), deviated pursuit with δ = 60°.',
        cases: [{ label: 'PNG', plaw: 'png' }, { label: 'PPG', plaw: 'ppg' }, { label: 'DPG', plaw: 'dpg' }] },
      { label: 'Stationary evader: defender position', base: { tg: 20, vE: 0, lEP: 2 },
        desc: 'The evader does not move. Pursuer at 5000 m (LOS 2°); the defender starts at three positions and aims for χ* = 180°.',
        cases: [{ label: '400 m, −45°', rED: 400, lED: -45 }, { label: '1500 m, −10°', rED: 1500, lED: -10 }, { label: '2000 m, 10°', rED: 2000, lED: 10 }] },
      { label: 'Stationary evader: pursuer position', base: { tg: 20, vE: 0, rED: 400, lED: -45 },
        desc: 'The evader does not move. Defender at 400 m (LOS −45°); the pursuer starts 5000 m away at three LOS angles. χ* = 180°.',
        cases: [{ label: 'LOS −5°', lEP: -5 }, { label: 'LOS 0°', lEP: 0 }, { label: 'LOS 2°', lEP: 2 }], on: 2 },
      { label: 'Reduced acceleration', base: { tg: 20, rED: 400, aP: 8, aD: 8, aE: 4 },
        desc: 'Limits cut to 8 g for the pursuer and defender and 4 g for the evader. Defender at 400 m, otherwise as for χ* = 180°.',
        cases: [{ label: '8 g / 8 g / 4 g' }] }
    ],
    ilc: [
      { label: 'Different χ*',
        desc: 'Evader at the origin heading 45°. Defender at 500 m (LOS 45°) heading 0°; pursuer at 5000 m heading 180°, using PN with 𝒩 = 3. The evader becomes bait at t<sub>2</sub> = 4 s.',
        cases: [{ label: 'χ* = 150°', chi: 150 }, { label: 'χ* = 180°', chi: 180 }, { label: 'χ* = 200°', chi: 200 }], on: 1 },
      { label: 'Bait time t<sub>2</sub>',
        desc: 'Same geometry with χ* = 180°. The evader nulls its LOS rate to the pursuer at t<sub>2</sub> = 4, 6 or 8 s.',
        cases: [{ label: 't₂ = 4 s', t2: 4 }, { label: 't₂ = 6 s', t2: 6 }, { label: 't₂ = 8 s', t2: 8 }] },
      { label: 'Pursuer guidance',
        desc: 'Same geometry with χ* = 180°. PNG with 𝒩 = 3; biased PNG a<sub>P</sub> = −𝒩ṙ<sub>EP</sub>λ̇<sub>EP</sub> + 1.5a<sub>E</sub>, where the pursuer knows the evader’s maneuver; pure pursuit.',
        cases: [{ label: 'PNG', plaw: 'png' }, { label: 'BPNG', plaw: 'bpng' }, { label: 'PPG', plaw: 'ppg' }] },
      { label: 'Communication delay',
        desc: 'Same geometry with χ* = 180°. The defender receives the evader’s command a<sub>E</sub>(t − τ).',
        cases: [{ label: 'τ = 0', tau: 0 }, { label: 'τ = 0.3 s', tau: 0.3 }, { label: 'τ = 0.6 s', tau: 0.6 }, { label: 'τ = 1 s', tau: 1 }] }
    ]
  };
  function peOptions(mode, si, ci) {
    var s = PE_SCN[mode][si], o = { mode: mode }, src = [PE_BASE[mode], s.base || {}, s.cases[ci]];
    src.forEach(function (x) { for (var k in x) if (k !== 'label') o[k] = x[k]; });
    return o;
  }

  // One engagement of the paper, for the options built by peOptions.
  function peSimulate(o) {
    var ilc = o.mode === 'ilc', d = DEG, H = 0.002, REC = 0.02, every = Math.round(REC / H), TMAX = 30;
    var VP = PE_V.P, VD = PE_V.D, VE = o.vE, g = 9.8;
    var xE = 0, yE = 0, gE = o.gE * d;
    var xD = o.rED * Math.cos(o.lED * d), yD = o.rED * Math.sin(o.lED * d), gD = o.gD * d;
    var xP = o.rEP * Math.cos(o.lEP * d), yP = o.rEP * Math.sin(o.lEP * d), gP = o.gP * d;
    var chis = o.chi * d, S0 = null, he0 = null, amEh = [], nDel = Math.round((o.tau || 0) / H);
    var rec = { E: [], P: [], D: [], gE: [], gP: [], gD: [], chi: [], rdp: [], rep: [], t: [] };
    var out = { rec: rec, end: 'timeout', tEnd: TMAX };
    for (var k = 0; ; k++) {
      var t = k * H;
      var RDP = Math.hypot(xP - xD, yP - yD), RED = Math.hypot(xD - xE, yD - yE), REP = Math.hypot(xP - xE, yP - yE);
      var lDP = Math.atan2(yP - yD, xP - xD), lED = Math.atan2(yD - yE, xD - xE), lEP = Math.atan2(yP - yE, xP - xE);
      var RDPd = VP * Math.cos(gP - lDP) - VD * Math.cos(gD - lDP);
      var REPd = VP * Math.cos(gP - lEP) - VE * Math.cos(gE - lEP);
      var REDd = VD * Math.cos(gD - lED) - VE * Math.cos(gE - lED);
      var lDPd = (VP * Math.sin(gP - lDP) - VD * Math.sin(gD - lDP)) / RDP;
      var lEPd = (VP * Math.sin(gP - lEP) - VE * Math.sin(gE - lEP)) / REP;
      var lEDd = (VD * Math.sin(gD - lED) - VE * Math.sin(gE - lED)) / RED;
      var chi = ((Math.PI + lDP - lED) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      if (k % every === 0) {
        rec.E.push([xE, yE]); rec.P.push([xP, yP]); rec.D.push([xD, yD]);
        rec.gE.push(gE); rec.gP.push(gP); rec.gD.push(gD);
        rec.chi.push(chi / d); rec.rdp.push(RDP); rec.rep.push(REP); rec.t.push(t);
      }
      if (RDP <= 2) { out.end = 'intercept'; out.tEnd = t; break; }
      if (REP <= 2) { out.end = 'evader hit'; out.tEnd = t; break; }
      if (t >= TMAX) break;
      var beta = chi - chis, bd = lDPd - lEDd, gdot, S, tl = o.ts - t;
      if (tl > o.marg) { gdot = -o.k1 / tl * bd - o.k1 * beta / (tl * tl); S = bd + o.k1 / tl * beta; }
      else { gdot = -o.k1 / o.marg * bd - o.k1 * beta / (o.marg * o.marg); S = bd + o.k1 / o.marg * beta; }
      if (S0 === null) S0 = -S;
      var ht = 0, hd = 0;
      if (t < o.t1) { ht = S0 / Math.pow(o.t1, o.k2) * Math.pow(o.t1 - t, o.k2); hd = -S0 / Math.pow(o.t1, o.k2) * o.k2 * Math.pow(o.t1 - t, o.k2 - 1); }
      var Si = S + ht;
      var a1 = Math.cos(gE - lED) / RED, a2 = Math.cos(gD - lDP) / RDP + Math.cos(gD - lED) / RED;
      var amD, amE;
      if (ilc) {
        // Theorem 3: the evader nulls its LOS rate to the pursuer at t2 and becomes bait
        if (he0 === null) he0 = -lEPd;
        var hE = 0, hEd = 0, t2 = o.t2, p3 = Math.pow(t2, o.k3);
        if (t < t2) { hE = he0 / p3 * Math.pow(t2 - t, o.k3); hEd = -he0 / p3 * o.k3 * Math.pow(t2 - t, o.k3 - 1); }
        amE = REP / Math.cos(gE - lEP) * (-2 * REPd * lEPd / REP + hEd + o.K1 * Math.tanh(o.tg * (lEPd + hE)));
        amEh.push(amE);
        var amEd = amEh.length > nDel ? amEh[amEh.length - 1 - nDel] : 0;   // defender receives a_E(t − τ)
        // Theorem 4: defender law built on the evader's (delayed) command
        amD = (-2 * RDPd * lDPd / RDP + 2 * REDd * lEDd / RED + a1 * amEd - gdot + hd + o.K * Math.tanh(o.tg * Si)) / a2;
      } else {
        // Theorems 1–2: net cooperative control U, split by minimum-norm allocation (all of it to D if E is stationary)
        var U = 2 * RDPd * lDPd / RDP - 2 * REDd * lEDd / RED + gdot - hd - o.K * Math.tanh(o.tg * Si);
        if (VE === 0) { amD = -U / a2; amE = 0; }
        else { amD = -U * a2 / (a2 * a2 + a1 * a1); amE = U * a1 / (a2 * a2 + a1 * a1); }
      }
      var amP;
      if (o.plaw === 'ppg') amP = VP * lEPd - (ilc ? 0.1 : 0.5) * (gP - lEP);
      else if (o.plaw === 'dpg') amP = VP * lEPd - (gP - lEP - Math.PI / 3);
      else if (o.plaw === 'bpng') amP = -o.N * REPd * lEPd + 1.5 * amE;
      else amP = -o.N * REPd * lEPd;
      amD = clamp(amD, -o.aD * g, o.aD * g); amP = clamp(amP, -o.aP * g, o.aP * g); amE = clamp(amE, -o.aE * g, o.aE * g);
      xD += VD * Math.cos(gD) * H; yD += VD * Math.sin(gD) * H; gD += amD / VD * H;
      xP += VP * Math.cos(gP) * H; yP += VP * Math.sin(gP) * H; gP += amP / VP * H;
      if (VE > 0) { xE += VE * Math.cos(gE) * H; yE += VE * Math.sin(gE) * H; gE += amE / VE * H; }
    }
    out.G = o;
    return out;
  }

  function fitView(pts, w, h, pad) {
    var mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    pts.forEach(function (p) { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); });
    var s = Math.min((w - 2 * pad) / Math.max(mxx - mnx, 1), (h - 2 * pad) / Math.max(mxy - mny, 1));
    var ox = (w - s * (mxx - mnx)) / 2 - s * mnx, oy = (h + s * (mxy - mny)) / 2 + s * mny;
    return { w: w, h: h, s: s, f: function (x, y) { return [ox + s * x, oy - s * y]; },
      inv: function (px, py) { return [(px - ox) / s, (oy - py) / s]; } };
  }
  function polyline(ctx, view, pts, upto) {
    ctx.beginPath();
    for (var j = 0; j <= upto && j < pts.length; j++) { var q = view.f(pts[j][0], pts[j][1]); if (j === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
    ctx.stroke();
  }

  function initPE(root) {
    var cv = root.querySelector('canvas.pf-main');
    var cvC = root.querySelector('canvas.pf-chart-r');
    var cvR = root.querySelector('canvas.pf-chart-xi');
    var out = root.querySelector('.pf-readout');
    var leg = root.querySelector('.pf-legend');
    var btnPlay = root.querySelector('[data-act="play"]');
    var rowS = root.querySelector('.pe-scn'), rowC = root.querySelector('.pe-case'), desc = root.querySelector('.pe-desc');
    var mode = 'mlc', si = 0, ci = PE_SCN.mlc[0].on || 0;
    var res, t = 0, hold = 0, view = null;
    legend(leg, [{ color: CE, label: 'evader E' }, { color: CP, label: 'pursuer P' }, { color: CD, label: 'defender D' },
      { color: 'rgba(22,163,74,0.45)', label: 'circle on EP (D inside ⇒ χ ∈ [90°, 270°])' }]);

    function reset() { res = peSimulate(peOptions(mode, si, ci)); t = 0; hold = 0; view = null; }
    function buttons(row, items, cur, pick) {
      row.innerHTML = '';
      items.forEach(function (it, j) {
        var b = document.createElement('button'); b.innerHTML = it.label; if (j === cur) b.className = 'on';
        b.addEventListener('click', function () { pick(j); }); row.appendChild(b);
      });
    }
    function build() {
      var list = PE_SCN[mode], sc = list[si];
      buttons(rowS, list, si, function (j) { si = j; ci = list[j].on || 0; build(); });
      buttons(rowC, sc.cases, ci, function (j) { ci = j; build(); });
      desc.innerHTML = sc.desc;
      reset(); if (anim) anim.kick();
    }
    function idx() { return Math.min(res.rec.t.length - 1, Math.floor(t / 0.02)); }

    function draw() {
      var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h, th = theme(), r = res.rec;
      if (!view || view.w !== w || view.h !== h) view = fitView(r.E.concat(r.P, r.D, [[0, 600], [0, -600]]), w, h, 34);
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (var gy = 0; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
      var i = idx(), E = view.f(r.E[i][0], r.E[i][1]), P = view.f(r.P[i][0], r.P[i][1]), D = view.f(r.D[i][0], r.D[i][1]);
      var done = res.end === 'intercept' && i === r.t.length - 1;
      // circle with diameter EP
      var inside = r.chi[i] >= 90 && r.chi[i] <= 270;
      if (!done) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
        ctx.beginPath(); ctx.arc((E[0] + P[0]) / 2, (E[1] + P[1]) / 2, Math.hypot(P[0] - E[0], P[1] - E[1]) / 2, 0, 7);
        ctx.fillStyle = inside ? 'rgba(22,163,74,0.07)' : 'rgba(220,38,38,0.07)'; ctx.fill();
        ctx.setLineDash([6, 5]); ctx.strokeStyle = inside ? 'rgba(22,163,74,0.6)' : 'rgba(220,38,38,0.6)'; ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();
      }
      // trails
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = CE; polyline(ctx, view, r.E, i);
      ctx.strokeStyle = CP; polyline(ctx, view, r.P, i);
      ctx.strokeStyle = CD; polyline(ctx, view, r.D, i);
      [[r.E[0], CE], [r.P[0], CP], [r.D[0], CD]].forEach(function (s) { var q = view.f(s[0][0], s[0][1]); ctx.fillStyle = s[1]; ctx.fillRect(q[0] - 4, q[1] - 4, 8, 8); });
      if (!done) {
        // lines of sight and the angle chi at D
        ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(37,99,235,0.7)'; ctx.beginPath(); ctx.moveTo(D[0], D[1]); ctx.lineTo(E[0], E[1]); ctx.stroke();
        ctx.strokeStyle = 'rgba(220,38,38,0.7)'; ctx.beginPath(); ctx.moveTo(D[0], D[1]); ctx.lineTo(P[0], P[1]); ctx.stroke();
        ctx.setLineDash([]);
        var aE = Math.atan2(E[1] - D[1], E[0] - D[0]), aP = Math.atan2(P[1] - D[1], P[0] - D[0]);
        ctx.strokeStyle = CD; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(D[0], D[1], 20, aE, aP, true); ctx.stroke();
        ctx.fillStyle = CD; ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText('χ = ' + fmt(r.chi[i], 0) + '°', D[0] + 24, D[1] - 6);
      }
      function heading(g, at) { var q = view.f(at[0] + Math.cos(g), at[1] + Math.sin(g)), o = view.f(at[0], at[1]); return Math.atan2(q[1] - o[1], q[0] - o[0]); }
      drawPlane(ctx, E[0], E[1], heading(r.gE[i], r.E[i]), 11, CE, th.halo);
      if (done) {
        var k = Math.min(1, hold / 1.2); drawBurst(ctx, P[0], P[1], k);
      } else {
        drawMissile(ctx, P[0], P[1], heading(r.gP[i], r.P[i]), 9, CP, th.halo);
        drawMissile(ctx, D[0], D[1], heading(r.gD[i], r.D[i]), 9, CD, th.halo);
      }
      ctx.font = '600 12px Inter, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      ctx.fillStyle = CE; ctx.fillText('E', E[0] + 10, E[1] + 8);
      if (!done) { ctx.fillStyle = CP; ctx.fillText('P', P[0] + 10, P[1] + 8); ctx.fillStyle = CD; ctx.fillText('D', D[0] + 10, D[1] + 8); }
      ctx.fillStyle = th.muted; ctx.fillText('t = ' + fmt(r.t[i], 1) + ' s', 12, 10);
      if (done) {
        ctx.font = '600 13px Inter, sans-serif'; ctx.fillStyle = CD; ctx.textAlign = 'right';
        ctx.fillText('Pursuer intercepted at t = ' + fmt(res.tEnd, 2) + ' s', w - 12, 10);
        ctx.fillStyle = th.muted; ctx.font = '12px Inter, sans-serif';
        ctx.fillText('evader is ' + fmt(r.rep[i] / 1000, 2) + ' km away', w - 12, 28);
      }
    }

    function charts() {
      var r = res.rec, i = idx(), T = Math.ceil(r.t[r.t.length - 1] / 5) * 5 || 5;
      var pc = []; for (var j = 0; j <= i; j += 2) pc.push([r.t[j], r.chi[j]]);
      drawChart(cvC, 'angle χ (target χ* = ' + res.G.chi + '°)', 'deg', T, 0, 360, [{ color: CD, pts: pc }], r.t[i]);
      var fc = fitCanvas(cvC), c = fc.ctx, ph = fc.h - 36;
      function Y(v) { return 18 + ph * (1 - v / 360); }
      c.fillStyle = 'rgba(22,163,74,0.10)'; c.fillRect(38, Y(270), fc.w - 46, Y(90) - Y(270));
      c.strokeStyle = CD; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(38, Y(res.G.chi)); c.lineTo(fc.w - 8, Y(res.G.chi)); c.stroke(); c.setLineDash([]);
      var tsx = 38 + (fc.w - 46) * res.G.ts / T;
      c.strokeStyle = 'rgba(100,116,139,0.6)'; c.beginPath(); c.moveTo(tsx, 18); c.lineTo(tsx, 18 + ph); c.stroke();
      c.fillStyle = theme().muted; c.font = '10px Inter, sans-serif'; c.textAlign = 'left'; c.fillText('t* = ' + res.G.ts + ' s', tsx + 3, 22);
      var a = [], b = []; for (j = 0; j <= i; j += 2) { a.push([r.t[j], r.rdp[j] / 1000]); b.push([r.t[j], r.rep[j] / 1000]); }
      drawChart(cvR, 'ranges r_DP (green), r_EP (red)', 'km', T, 0, Math.ceil(Math.max(r.rep[0], r.rdp[0]) / 1000), [{ color: CD, pts: a }, { color: CP, pts: b }], r.t[i]);
      var st = res.end === 'intercept' && i === r.t.length - 1 ? '<b style="color:#16a34a">intercepted</b>' :
        (res.end === 'evader hit' && i === r.t.length - 1 ? '<b style="color:#dc2626">evader hit</b>' : '<b>in progress</b>');
      out.innerHTML =
        '<div><span>angle χ</span><b>' + fmt(r.chi[i], 1) + '°</b></div>' +
        '<div><span>status</span>' + st + '</div>' +
        '<div><span>range r<sub>DP</sub></span><b>' + fmt(r.rdp[i], 0) + ' m</b></div>' +
        '<div><span>range r<sub>EP</sub></span><b>' + fmt(r.rep[i], 0) + ' m</b></div>';
    }

    var frame = 0;
    var anim = animator(root, function (dt) {
      var tEnd = res.rec.t[res.rec.t.length - 1];
      if (t >= tEnd) { hold += dt; if (hold > 2.5) { t = 0; hold = 0; } } else t = Math.min(tEnd, t + dt);
      draw(); if (frame++ % 3 === 0) charts();
    });
    root.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('[data-mode]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); mode = b.getAttribute('data-mode'); si = 0; ci = PE_SCN[mode][0].on || 0; build();
      });
    });
    root.querySelector('[data-act="reset"]').addEventListener('click', function () { reset(); anim.kick(); });
    btnPlay.addEventListener('click', function () { anim.paused = !anim.paused; btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause'; anim.kick(); });
    btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause';
    build();
  }

  /* ── one-to-one assignment: Hungarian, greedy, auction (as in the paper's code) ── */
  function assignHungarian(C) {
    var n = C.length, INF = 1e18, u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
    for (var i = 1; i <= n; i++) {
      p[0] = i; var j0 = 0, minv = new Array(n + 1).fill(INF), used = new Array(n + 1).fill(false);
      do {
        used[j0] = true; var i0 = p[j0], delta = INF, j1 = 0;
        for (var j = 1; j <= n; j++) if (!used[j]) {
          var cur = C[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { var jj = way[j0]; p[j0] = p[jj]; j0 = jj; } while (j0);
    }
    var a = new Array(n); for (var jx = 1; jx <= n; jx++) a[p[jx] - 1] = jx - 1; return a;
  }
  function assignGreedy(C) {
    var n = C.length, a = new Array(n).fill(-1), rowUsed = [], colUsed = [];
    for (var k = 0; k < n; k++) {
      var best = 1e18, bi = -1, bj = -1;
      for (var i = 0; i < n; i++) if (!rowUsed[i]) for (var j = 0; j < n; j++) if (!colUsed[j] && C[i][j] < best) { best = C[i][j]; bi = i; bj = j; }
      a[bi] = bj; rowUsed[bi] = colUsed[bj] = true;
    }
    return a;
  }
  function assignAuction(C) {
    var n = C.length, mx = 0, i, j;
    C.forEach(function (r) { r.forEach(function (c) { mx = Math.max(mx, c); }); });
    var price = new Array(n).fill(0), owner = new Array(n).fill(-1), a = new Array(n).fill(-1), queue = [], eps = 1 / (n + 1), it = 0;
    for (i = 0; i < n; i++) queue.push(i);
    while (queue.length && it++ < n * n * 10) {
      i = queue.shift();
      var best = -1e18, second = -1e18, jb = 0;
      for (j = 0; j < n; j++) { var val = (mx - C[i][j]) - price[j]; if (val > best) { second = best; best = val; jb = j; } else if (val > second) second = val; }
      price[jb] += best - second + eps;
      if (owner[jb] >= 0) { a[owner[jb]] = -1; queue.push(owner[jb]); }
      owner[jb] = i; a[i] = jb;
    }
    // as in the paper's code: anyone left unassigned after the iteration cap takes a free pursuer
    var free = []; for (j = 0; j < n; j++) if (a.indexOf(j) < 0) free.push(j);
    for (i = 0; i < n; i++) if (a[i] < 0) a[i] = free.shift();
    return a;
  }

  function initPEMulti(root) {
    var cv = root.querySelector('canvas.pf-main');
    var out = root.querySelector('.pf-readout');
    var leg = root.querySelector('.pf-legend');
    var btnPlay = root.querySelector('[data-act="play"]');
    var N = 20, H = 0.001, REC = 0.02, every = Math.round(REC / H), TMAX = 30, method = 'hungarian';
    var res, t = 0, hold = 0, view = null;
    legend(leg, [{ color: CE, label: 'evader' }, { color: CP, label: 'pursuers' }, { color: CD, label: 'defenders' }, { color: 'rgba(100,116,139,0.6)', label: 'initial assignment' }]);

    function lin(a, b, k) { return a + (b - a) * k / (N - 1); }
    function simulate() {
      var D0 = [], P0 = [], i, j;
      for (i = 0; i < N; i++) {
        var lED = lin(-60, 80, i) * DEG, rED = lin(100, 500, i), lEP = lin(-20, 20, i) * DEG, rEP = lin(4000, 5000, i);
        D0.push([rED * Math.cos(lED), rED * Math.sin(lED)]); P0.push([rEP * Math.cos(lEP), rEP * Math.sin(lEP)]);
      }
      var C = D0.map(function (d) { return P0.map(function (p) { return Math.hypot(d[0] - p[0], d[1] - p[1]); }); });
      var asg = method === 'hungarian' ? assignHungarian(C) : (method === 'greedy' ? assignGreedy(C) : (method === 'auction' ? assignAuction(C) : D0.map(function (_, k) { return k; })));
      var J = 0; for (i = 0; i < N; i++) J += C[i][asg[i]];
      var pairs = [];
      for (i = 0; i < N; i++) pairs.push({ xD: D0[i][0], yD: D0[i][1], gD: 0, xP: P0[asg[i]][0], yP: P0[asg[i]][1], gP: Math.PI,
        Dtr: [], Ptr: [], cap: null, S0: null, from: D0[i], to: P0[asg[i]] });
      var xE = 0, yE = 0, gE = Math.PI / 2, Etr = [], k1 = 3, k2 = 3, t1 = 4, ts = 8, K = 1, eps = 0.1;
      var n = Math.round(TMAX / H);
      for (var k = 0; k <= n; k++) {
        var t = k * H, rec = k % every === 0;
        if (rec) Etr.push([xE, yE]);
        pairs.forEach(function (q) {
          if (rec) { q.Dtr.push([q.xD, q.yD]); q.Ptr.push([q.xP, q.yP]); }
          if (q.cap !== null) return;
          var RDP = Math.hypot(q.xP - q.xD, q.yP - q.yD), RED = Math.hypot(q.xD - xE, q.yD - yE), REP = Math.hypot(q.xP - xE, q.yP - yE);
          if (RDP <= 1) { q.cap = t; return; }
          var lDP = Math.atan2(q.yP - q.yD, q.xP - q.xD), lED = Math.atan2(q.yD - yE, q.xD - xE), lEP = Math.atan2(q.yP - yE, q.xP - xE);
          var RDPd = PE_V.P * Math.cos(q.gP - lDP) - PE_V.D * Math.cos(q.gD - lDP);
          var REPd = PE_V.P * Math.cos(q.gP - lEP) - PE_V.E * Math.cos(gE - lEP);
          var REDd = PE_V.D * Math.cos(q.gD - lED) - PE_V.E * Math.cos(gE - lED);
          var lDPd = (PE_V.P * Math.sin(q.gP - lDP) - PE_V.D * Math.sin(q.gD - lDP)) / RDP;
          var lEPd = (PE_V.P * Math.sin(q.gP - lEP) - PE_V.E * Math.sin(gE - lEP)) / REP;
          var lEDd = (PE_V.D * Math.sin(q.gD - lED) - PE_V.E * Math.sin(gE - lED)) / RED;
          var chi = ((Math.PI + lDP - lED) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), beta = chi - Math.PI, bd = lDPd - lEDd;
          var tl = Math.max(ts - t, eps), gdot = -k1 / tl * bd - k1 * beta / (tl * tl), S = bd + k1 / tl * beta;
          if (q.S0 === null) q.S0 = -S;
          var ht = 0, hd = 0;
          if (t < t1) { ht = q.S0 / Math.pow(t1, k2) * Math.pow(t1 - t, k2); hd = -q.S0 / Math.pow(t1, k2) * k2 * Math.pow(t1 - t, k2 - 1); }
          var a2 = Math.cos(q.gD - lDP) / RDP + Math.cos(q.gD - lED) / RED;
          var amD = clamp((-2 * RDPd * lDPd / RDP + 2 * REDd * lEDd / RED - gdot + hd + K * Math.tanh(30 * (S + ht))) / a2, -196, 196);
          var amP = clamp(-3 * REPd * lEPd, -196, 196);
          q.xD += PE_V.D * Math.cos(q.gD) * H; q.yD += PE_V.D * Math.sin(q.gD) * H; q.gD += amD / PE_V.D * H;
          q.xP += PE_V.P * Math.cos(q.gP) * H; q.yP += PE_V.P * Math.sin(q.gP) * H; q.gP += amP / PE_V.P * H;
        });
        xE += PE_V.E * Math.cos(gE) * H; yE += PE_V.E * Math.sin(gE) * H;
        if (pairs.every(function (q) { return q.cap !== null; }) && k % every === 0) break;
      }
      return { pairs: pairs, E: Etr, J: J };
    }
    function reset() { res = simulate(); t = 0; hold = 0; view = null; }

    function draw() {
      var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h, th = theme();
      if (!view || view.w !== w || view.h !== h) {
        var pts = res.E.slice(); res.pairs.forEach(function (q) { pts = pts.concat(q.Dtr, q.Ptr); });
        view = fitView(pts, w, h, 30);
      }
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (var gy = 0; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
      var i = Math.min(res.E.length - 1, Math.floor(t / REC)), caught = 0, last = 0;
      // initial assignment
      ctx.strokeStyle = 'rgba(100,116,139,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      res.pairs.forEach(function (q) { var a = view.f(q.from[0], q.from[1]), b = view.f(q.to[0], q.to[1]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });
      ctx.setLineDash([]);
      ctx.lineWidth = 1.6;
      res.pairs.forEach(function (q) {
        var m = Math.min(i, q.Dtr.length - 1);
        ctx.strokeStyle = 'rgba(220,38,38,0.85)'; polyline(ctx, view, q.Ptr, m);
        ctx.strokeStyle = 'rgba(22,163,74,0.9)'; polyline(ctx, view, q.Dtr, m);
        var hit = q.cap !== null && q.cap <= i * REC;
        var P = view.f(q.Ptr[m][0], q.Ptr[m][1]);
        if (hit) {
          caught++; last = Math.max(last, q.cap);
          ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2; ctx.beginPath();
          ctx.moveTo(P[0] - 5, P[1] - 5); ctx.lineTo(P[0] + 5, P[1] + 5); ctx.moveTo(P[0] + 5, P[1] - 5); ctx.lineTo(P[0] - 5, P[1] + 5); ctx.stroke(); ctx.lineWidth = 1.6;
        } else {
          var P2 = q.Ptr[Math.max(0, m - 1)], D = view.f(q.Dtr[m][0], q.Dtr[m][1]), D2 = q.Dtr[Math.max(0, m - 1)];
          var pa = view.f(P2[0], P2[1]), da = view.f(D2[0], D2[1]);
          ctx.fillStyle = CP; ctx.beginPath(); ctx.arc(P[0], P[1], 3, 0, 7); ctx.fill();
          ctx.fillStyle = CD; ctx.beginPath(); ctx.arc(D[0], D[1], 3, 0, 7); ctx.fill();
        }
      });
      ctx.strokeStyle = CE; ctx.lineWidth = 2.4; polyline(ctx, view, res.E, i);
      var E = view.f(res.E[i][0], res.E[i][1]);
      drawPlane(ctx, E[0], E[1], -Math.PI / 2, 11, CE, th.halo);
      ctx.fillStyle = th.muted; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('t = ' + fmt(i * REC, 1) + ' s', 12, 10);
      out.innerHTML =
        '<div><span>assignment</span><b>' + ({ hungarian: 'Hungarian', greedy: 'greedy', auction: 'auction', none: 'none (index order)' })[method] + '</b></div>' +
        '<div><span>total initial D–P distance J</span><b>' + fmt(res.J / 1000, 1) + ' km</b></div>' +
        '<div><span>pursuers intercepted</span><b style="color:' + (caught === N ? '#16a34a' : 'inherit') + '">' + caught + ' / ' + N + '</b></div>' +
        '<div><span>last interception</span><b>' + (caught ? fmt(last, 2) + ' s' : '—') + '</b></div>';
    }

    var anim = animator(root, function (dt) {
      var tEnd = (res.E.length - 1) * REC;
      if (t >= tEnd) { hold += dt; if (hold > 2.5) { t = 0; hold = 0; } } else t = Math.min(tEnd, t + dt);
      draw();
    });
    root.querySelectorAll('[data-asg]').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('[data-asg]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); method = b.getAttribute('data-asg'); reset(); anim.kick();
      });
    });
    root.querySelector('[data-act="reset"]').addEventListener('click', function () { t = 0; hold = 0; anim.kick(); });
    btnPlay.addEventListener('click', function () { anim.paused = !anim.paused; btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause'; anim.kick(); });
    btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause';
    reset();
  }

  function init() {
    var a = document.getElementById('pf-sim2d'); if (a) initSim2D(a);
    var b = document.getElementById('pf-sim3d'); if (b) initSim3D(b);
    var c = document.getElementById('pf-sat'); if (c) initSat(c);
    var d = document.getElementById('pf-ct'); if (d) initCT(d);
    var e = document.getElementById('pe-sim'); if (e) initPE(e);
    var m = document.getElementById('pe-multi'); if (m) initPEMulti(m);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
