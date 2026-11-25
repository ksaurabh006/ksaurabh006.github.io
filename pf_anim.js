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
 *  7. #pe-tri     : triangle rule (Proposition 1): hold chi(0) with positive closing speed.
 *  8. #tt-usv     : exact-time tracking of a surface vessel (Trajectory Tracking page).
 *  9. #tt-blf     : BLF-constrained quadrotor tracking (JGCD 2026).
 * 10. #tt-ft      : finite-time quadrotor tracking and reaching-law comparison (IMechE G 2025).
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

  /* ── Triangle rule (Proposition 1): place E, P, D; the defender holds the initial chi with a positive
        closing speed, and the shrinking triangles end with r_DP = 0 while r_EP > 0. ── */
  function peChi(E, P, D) {
    var lDP = Math.atan2(P[1] - D[1], P[0] - D[0]), lED = Math.atan2(D[1] - E[1], D[0] - E[0]);
    return ((Math.PI + lDP - lED) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  }
  var TRI_PRESETS = {
    outside: { E: [0, 0], P: [5, 0], D: [0.4, 2.5] },
    right:   { E: [0, 0], P: [5, 0], D: [2.5 - 2.5 * Math.cos(1.1), 2.5 * Math.sin(1.1)] },
    inside:  { E: [0, 0], P: [5, 0], D: [1.6, 1.1] },
    reflex:  { E: [0, 0], P: [5, 0], D: [1.5, -1.2] }
  };
  // Positions in km. The pursuer flies at the evader with PN (N = 5); the evader flees along the EP line.
  // The defender starts on the heading that gives d(chi)/dt = 0 with the fastest closing on P, and then
  // the maneuver-level law of the paper holds chi* = chi(0).
  function triSimulate(p) {
    var VP = 200, VD = 200, VE = 100, d = DEG, H = 0.002, every = 10, TMAX = 40, g = 9.8;
    var xE = p.E[0] * 1000, yE = p.E[1] * 1000, xP = p.P[0] * 1000, yP = p.P[1] * 1000, xD = p.D[0] * 1000, yD = p.D[1] * 1000;
    var gP = Math.atan2(yE - yP, xE - xP), gE = gP;
    var chis = peChi(p.E, p.P, p.D);
    var lDP0 = Math.atan2(yP - yD, xP - xD), lED0 = Math.atan2(yD - yE, xD - xE), R1 = Math.hypot(xP - xD, yP - yD), R2 = Math.hypot(xD - xE, yD - yE);
    function bdot(gD) {
      return (VP * Math.sin(gP - lDP0) - VD * Math.sin(gD - lDP0)) / R1 - (VD * Math.sin(gD - lED0) - VE * Math.sin(gE - lED0)) / R2;
    }
    var gD = lDP0, best = 0, prev = bdot(0);
    for (var j = 1; j <= 3600; j++) {
      var gg = j * 0.1 * d, cur = bdot(gg);
      if ((prev <= 0) !== (cur <= 0)) {
        var cl = VP * Math.cos(gP - lDP0) - VD * Math.cos(gg - lDP0);   // range rate; negative = closing
        if (cl < best) { best = cl; gD = gg; }
      }
      prev = cur;
    }
    var o = { k1: 6, k2: 3, t1: 3, ts: 6, K: 5, marg: 0.2, tg: 20 }, S0 = null;
    var rec = { E: [], P: [], D: [], gE: [], gP: [], gD: [], chi: [], rdp: [], rep: [], vc: [], t: [] };
    var out = { rec: rec, end: 'timeout', tEnd: TMAX, chi0: chis / d };
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
        rec.E.push([xE, yE]); rec.P.push([xP, yP]); rec.D.push([xD, yD]); rec.gE.push(gE); rec.gP.push(gP); rec.gD.push(gD);
        rec.chi.push(chi / d); rec.rdp.push(RDP); rec.rep.push(REP); rec.vc.push(-RDPd); rec.t.push(t);
      }
      if (RDP <= 5) { out.end = 'intercept'; out.tEnd = t; break; }
      if (REP <= 5) { out.end = 'evader hit'; out.tEnd = t; break; }
      if (t >= TMAX) break;
      var beta = Math.atan2(Math.sin(chi - chis), Math.cos(chi - chis)), bd = lDPd - lEDd, gdot, S, tl = o.ts - t;
      if (tl > o.marg) { gdot = -o.k1 / tl * bd - o.k1 * beta / (tl * tl); S = bd + o.k1 / tl * beta; }
      else { gdot = -o.k1 / o.marg * bd - o.k1 * beta / (o.marg * o.marg); S = bd + o.k1 / o.marg * beta; }
      if (S0 === null) S0 = -S;
      var hd = 0, ht = 0;
      if (t < o.t1) { ht = S0 / Math.pow(o.t1, o.k2) * Math.pow(o.t1 - t, o.k2); hd = -S0 / Math.pow(o.t1, o.k2) * o.k2 * Math.pow(o.t1 - t, o.k2 - 1); }
      var a1 = Math.cos(gE - lED) / RED, a2 = Math.cos(gD - lDP) / RDP + Math.cos(gD - lED) / RED;
      var U = 2 * RDPd * lDPd / RDP - 2 * REDd * lEDd / RED + gdot - hd - o.K * Math.tanh(o.tg * (S + ht));
      var amD = clamp(-U * a2 / (a2 * a2 + a1 * a1), -20 * g, 20 * g), amE = clamp(U * a1 / (a2 * a2 + a1 * a1), -10 * g, 10 * g);
      var amP = clamp(-5 * REPd * lEPd, -20 * g, 20 * g);
      xD += VD * Math.cos(gD) * H; yD += VD * Math.sin(gD) * H; gD += amD / VD * H;
      xP += VP * Math.cos(gP) * H; yP += VP * Math.sin(gP) * H; gP += amP / VP * H;
      xE += VE * Math.cos(gE) * H; yE += VE * Math.sin(gE) * H; gE += amE / VE * H;
    }
    return out;
  }

  function initTri(root) {
    var cv = root.querySelector('canvas.pf-main'), out = root.querySelector('.pf-readout'), leg = root.querySelector('.pf-legend');
    var cvC = root.querySelector('canvas.pf-chart-r'), cvR = root.querySelector('canvas.pf-chart-xi');
    var btnPlay = root.querySelector('[data-act="play"]');
    var pts = JSON.parse(JSON.stringify(TRI_PRESETS.inside)), drag = null, view = null, res = null, t = 0, hold = 0, frame = 0;
    legend(leg, [{ color: CE, label: 'evader E' }, { color: CP, label: 'pursuer P' }, { color: CD, label: 'defender D' },
      { color: 'rgba(100,116,139,0.6)', label: 'triangle PED every 1.5 s' }, { color: 'rgba(22,163,74,0.45)', label: 'circle with diameter EP' }]);

    function mkView(w, h) {
      var s = Math.min(w / 8.8, h / 5.8), cx = w / 2 - s * 2.1, cy = h / 2;
      return { w: w, h: h, f: function (x, y) { return [cx + s * x, cy - s * y]; }, inv: function (px, py) { return [(px - cx) / s, (cy - py) / s]; } };
    }
    function run() { res = triSimulate(pts); t = 0; hold = 0; }
    function idx() { return Math.min(res.rec.t.length - 1, Math.floor(t / 0.02)); }
    function km(q) { return [q[0] / 1000, q[1] / 1000]; }

    function triangle(ctx, E, P, D, chiD, strong, th) {
      var rEP = Math.hypot(P[0] - E[0], P[1] - E[1]), rDP = Math.hypot(P[0] - D[0], P[1] - D[1]), rED = Math.hypot(D[0] - E[0], D[1] - E[1]);
      var inside = chiD >= 90 && chiD <= 270;
      ctx.beginPath(); ctx.arc((E[0] + P[0]) / 2, (E[1] + P[1]) / 2, rEP / 2, 0, 7);
      ctx.fillStyle = inside ? 'rgba(22,163,74,0.07)' : 'rgba(220,38,38,0.06)'; ctx.fill();
      ctx.setLineDash([6, 5]); ctx.strokeStyle = inside ? 'rgba(22,163,74,0.6)' : 'rgba(220,38,38,0.55)'; ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]);
      var longest = Math.max(rEP, rDP, rED);
      [[E, P, rEP, th.muted], [E, D, rED, CE], [D, P, rDP, CP]].forEach(function (sd) {
        ctx.strokeStyle = sd[3]; ctx.lineWidth = strong && sd[2] === longest ? 3.5 : 1.8;
        ctx.beginPath(); ctx.moveTo(sd[0][0], sd[0][1]); ctx.lineTo(sd[1][0], sd[1][1]); ctx.stroke();
      });
      var aE = Math.atan2(-(E[1] - D[1]), E[0] - D[0]), chi = chiD * DEG;
      ctx.strokeStyle = CD; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(D[0], D[1], 22, -aE, -(aE + chi), true); ctx.stroke();
      var am = aE + chi / 2;
      ctx.fillStyle = CD; ctx.font = '700 13px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('χ = ' + fmt(chiD, 0) + '°', D[0] + 46 * Math.cos(am), D[1] - 46 * Math.sin(am));
    }

    function draw() {
      var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h, th = theme();
      if (!view || view.w !== w || view.h !== h) view = mkView(w, h);
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (var gy = 0; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
      function V(q) { return view.f(q[0], q[1]); }
      ctx.fillStyle = th.muted; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      if (!res || drag) {
        // set-up: the static triangle, draggable
        triangle(ctx, V(pts.E), V(pts.P), V(pts.D), peChi(pts.E, pts.P, pts.D) / DEG, true, th);
        [['E', CE], ['P', CP], ['D', CD]].forEach(function (q) {
          var s = V(pts[q[0]]); ctx.beginPath(); ctx.arc(s[0], s[1], drag === q[0] ? 10 : 8, 0, 7); ctx.fillStyle = q[1]; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = th.bg; ctx.stroke();
          ctx.font = '700 13px Inter, sans-serif'; ctx.textBaseline = 'bottom'; ctx.fillText(q[0], s[0] + 11, s[1] - 6);
        });
        ctx.fillStyle = th.muted; ctx.font = '11px Inter, sans-serif'; ctx.textBaseline = 'top';
        ctx.fillText('drag E, P or D, then release to run', 12, 10);
        return;
      }
      var r = res.rec, i = idx(), done = i === r.t.length - 1 && res.end !== 'timeout';
      // ghost triangles every 1.5 s
      ctx.lineWidth = 1; ctx.strokeStyle = isDark() ? 'rgba(148,163,184,0.35)' : 'rgba(100,116,139,0.35)';
      for (var j = 0; j < i; j += 75) {
        var gE_ = V(km(r.E[j])), gP_ = V(km(r.P[j])), gD_ = V(km(r.D[j]));
        ctx.beginPath(); ctx.moveTo(gE_[0], gE_[1]); ctx.lineTo(gP_[0], gP_[1]); ctx.lineTo(gD_[0], gD_[1]); ctx.closePath(); ctx.stroke();
      }
      // trails and starting points (the starting points stay draggable)
      ctx.lineWidth = 2.2;
      [[r.E, CE], [r.P, CP], [r.D, CD]].forEach(function (s) {
        ctx.strokeStyle = s[1]; ctx.beginPath();
        for (var k = 0; k <= i; k++) { var q = V(km(s[0][k])); if (k === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
        ctx.stroke();
      });
      [['E', CE], ['P', CP], ['D', CD]].forEach(function (q) { var s = V(pts[q[0]]); ctx.fillStyle = q[1]; ctx.fillRect(s[0] - 5, s[1] - 5, 10, 10); });
      var E = V(km(r.E[i])), P = V(km(r.P[i])), D = V(km(r.D[i]));
      if (!done) triangle(ctx, E, P, D, r.chi[i], true, th);
      function hd(gv, at) { var a = V(km(at)), b = V([at[0] / 1000 + Math.cos(gv), at[1] / 1000 + Math.sin(gv)]); return Math.atan2(b[1] - a[1], b[0] - a[0]); }
      drawPlane(ctx, E[0], E[1], hd(r.gE[i], r.E[i]), 11, CE, th.halo);
      if (done && res.end === 'intercept') drawBurst(ctx, P[0], P[1], Math.min(1, hold / 1.2));
      else { drawMissile(ctx, P[0], P[1], hd(r.gP[i], r.P[i]), 9, CP, th.halo); drawMissile(ctx, D[0], D[1], hd(r.gD[i], r.D[i]), 9, CD, th.halo); }
      ctx.fillStyle = th.muted; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('t = ' + fmt(r.t[i], 1) + ' s', 12, 10);
      if (done) {
        ctx.textAlign = 'right'; ctx.font = '600 13px Inter, sans-serif';
        ctx.fillStyle = res.end === 'intercept' ? CD : CP;
        ctx.fillText(res.end === 'intercept' ? 'Pursuer intercepted at t = ' + fmt(res.tEnd, 2) + ' s' : 'Evader captured at t = ' + fmt(res.tEnd, 2) + ' s', w - 12, 10);
        ctx.fillStyle = th.muted; ctx.font = '12px Inter, sans-serif';
        if (res.end === 'intercept') ctx.fillText('r_EP is still ' + fmt(r.rep[i] / 1000, 2) + ' km', w - 12, 28);
      }
    }

    function charts() {
      var chi0 = res ? res.chi0 : peChi(pts.E, pts.P, pts.D) / DEG, inside = chi0 >= 90 && chi0 <= 270;
      if (!res || drag) {
        drawChart(cvC, 'angle χ (held at χ(0))', 'deg', 15, 0, 360, [], 0);
        drawChart(cvR, 'ranges r_DP (green), r_EP (red)', 'km', 15, 0, 6, [], 0);
        out.innerHTML = '<div><span>initial angle χ(0)</span><b>' + fmt(chi0, 1) + '°</b></div>' +
          '<div><span>D relative to the circle</span><b style="color:' + (inside ? CD : CP) + '">' + (inside ? 'inside' : 'outside') + '</b></div>';
        return;
      }
      var r = res.rec, i = idx(), T = Math.max(5, Math.ceil(r.t[r.t.length - 1] / 5) * 5);
      var pc = [], a = [], b = [];
      for (var j = 0; j <= i; j += 2) { pc.push([r.t[j], r.chi[j]]); a.push([r.t[j], r.rdp[j] / 1000]); b.push([r.t[j], r.rep[j] / 1000]); }
      drawChart(cvC, 'angle χ (held at χ(0) = ' + fmt(chi0, 0) + '°)', 'deg', T, 0, 360, [{ color: CD, pts: pc }], r.t[i]);
      var fc = fitCanvas(cvC), c = fc.ctx, ph = fc.h - 36;
      function Y(v) { return 18 + ph * (1 - v / 360); }
      c.fillStyle = 'rgba(22,163,74,0.10)'; c.fillRect(38, Y(270), fc.w - 46, Y(90) - Y(270));
      drawChart(cvR, 'ranges r_DP (green), r_EP (red)', 'km', T, 0, Math.ceil(Math.max(r.rep[0], r.rdp[0]) / 1000), [{ color: CD, pts: a }, { color: CP, pts: b }], r.t[i]);
      var last = i === r.t.length - 1;
      var st = last && res.end === 'intercept' ? '<b style="color:' + CD + '">pursuer intercepted</b>' :
        (last && res.end === 'evader hit' ? '<b style="color:' + CP + '">evader captured</b>' : '<b>in progress</b>');
      out.innerHTML =
        '<div><span>angle χ now / χ(0)</span><b>' + fmt(r.chi[i], 1) + '° / ' + fmt(chi0, 1) + '°</b></div>' +
        '<div><span>closing speed on P</span><b style="color:' + (r.vc[i] > 0 ? CD : CP) + '">' + fmt(r.vc[i], 0) + ' m/s</b></div>' +
        '<div><span>r<sub>DP</sub> / r<sub>EP</sub></span><b>' + fmt(r.rdp[i] / 1000, 2) + ' / ' + fmt(r.rep[i] / 1000, 2) + ' km</b></div>' +
        '<div><span>status</span>' + st + '</div>';
    }

    function pick(e) {
      var rc = cv.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top, best = null, bd = 24;
      ['D', 'P', 'E'].forEach(function (k) { var q = view.f(pts[k][0], pts[k][1]), dd = Math.hypot(q[0] - x, q[1] - y); if (dd < bd) { bd = dd; best = k; } });
      return { k: best, w: view.inv(x, y) };
    }
    cv.addEventListener('pointerdown', function (e) {
      if (!view) return; var p = pick(e); if (!p.k) return;
      drag = p.k; cv.setPointerCapture(e.pointerId); e.preventDefault(); anim.kick();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!view) return; var p = pick(e);
      cv.style.cursor = drag ? 'grabbing' : (p.k ? 'grab' : 'default');
      if (!drag) return;
      pts[drag] = [clamp(p.w[0], -1.2, 6.2), clamp(p.w[1], -2.6, 2.6)]; anim.kick();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      cv.addEventListener(ev, function () { if (!drag) return; drag = null; run(); anim.kick(); });
    });
    root.querySelectorAll('[data-tri]').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('[data-tri]').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on');
        pts = JSON.parse(JSON.stringify(TRI_PRESETS[b.getAttribute('data-tri')])); run(); anim.kick();
      });
    });
    root.querySelector('[data-act="reset"]').addEventListener('click', function () { t = 0; hold = 0; anim.kick(); });
    var anim = animator(root, function (dt) {
      if (res && !drag) {
        var tEnd = res.rec.t[res.rec.t.length - 1];
        if (t >= tEnd) { hold += dt; if (hold > 3) { t = 0; hold = 0; } } else t = Math.min(tEnd, t + dt * 1.5);
      }
      draw(); if (frame++ % 3 === 0) charts();
    });
    btnPlay.addEventListener('click', function () { anim.paused = !anim.paused; btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause'; anim.kick(); });
    btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause';
    run();
  }

  /* ── Exact-time trajectory tracking of a surface vessel (Basnet, Kumar & Kumar, IEEE JOE 2025).
        Port of Exact_Time_with_disturbance.m / exact_time_without_disturbance.m on CyberShip II. ── */
  var USV_P = (function () {
    var m = 23.8, Iz = 1.76, xg = 0.046, Xud = -2.0, Yvd = -10, Yrd = 0, Nvd = 0, Nrd = -1;
    return { m11: m - Xud, m22: m - Yvd, m23: m * xg - Yrd, m32: m * xg - Nvd, m33: Iz - Nrd,
      Xu: -0.72253, Xuu: -1.32742, Yv: -0.88965, Yvv: -36.47287, Nv: 0.0313, Nvv: 3.95645, Yrv: -0.805, Yr: -7.250,
      Yvr: -0.845, Yrr: -3.450, Nrv: 0.130, Nr: -1.9, Nvr: 0.08, Nrr: -0.75 };
  })();
  var USV_REF = {
    ellipse: function (t) { return [[4 * Math.sin(0.02 * t), 2.5 * (1 - Math.cos(0.02 * t)), 0.02 * t],
      [0.08 * Math.cos(0.02 * t), 0.05 * Math.sin(0.02 * t), 0.02], [-0.0016 * Math.sin(0.02 * t), 0.001 * Math.cos(0.02 * t), 0]]; },
    infinity: function (t) { return [[2 * Math.cos(0.1 * t), Math.sin(0.2 * t), 0.02 * t],
      [-0.2 * Math.sin(0.1 * t), 0.2 * Math.cos(0.2 * t), 0.02], [-0.02 * Math.cos(0.1 * t), -0.04 * Math.sin(0.2 * t), 0]]; }
  };
  var USV_SCN = [
    { label: 'Known disturbance bound', ref: 'ellipse', obs: false, tf: 10, T: 150,
      desc: 'Reference x<sub>d</sub> = 4 sin 0.02t, y<sub>d</sub> = 2.5(1 − cos 0.02t), ψ<sub>d</sub> = 0.02t. The vessel starts at (2, −3) m with ψ = π/6 and is at rest. t<sub>f</sub> = 10 s, t<sub>1</sub> = 5 s, with a time-varying disturbance whose bound is known.',
      cases: [{ label: 'start (2, −3), ψ = 30°', ic: [2, -3, Math.PI / 6] }] },
    { label: 'Disturbance observer', ref: 'ellipse', obs: true, tf: 10, T: 150,
      desc: 'Same reference and start, but the disturbance bound is unknown: a disturbance observer estimates it, and the model has a 10% error in its Coriolis and damping terms. t<sub>f</sub> = 10 s.',
      cases: [{ label: 'start (2, −3), ψ = 30°', ic: [2, -3, Math.PI / 6] }] },
    { label: 'Infinity-shaped reference', ref: 'infinity', obs: true, tf: 6, T: 70,
      desc: 'Reference x<sub>d</sub> = 2 cos 0.1t, y<sub>d</sub> = sin 0.2t, ψ<sub>d</sub> = 0.02t, with rapidly changing curvature. Two starting points, both at rest with ψ = π/3; t<sub>f</sub> = 6 s.',
      cases: [{ label: 'case 1: (−2, 1.5)', ic: [-2, 1.5, Math.PI / 3] }, { label: 'case 2: (1, −1)', ic: [1, -1, Math.PI / 3] }] }
  ];
  function m3v(A, v) { return [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2], A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2], A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]]; }
  function m3inv(A) {
    var a = A[0][0], b = A[0][1], c = A[0][2], d = A[1][0], e = A[1][1], f = A[1][2], g = A[2][0], h = A[2][1], i = A[2][2];
    var C0 = e * i - f * h, C1 = -(d * i - f * g), C2 = d * h - e * g, det = a * C0 + b * C1 + c * C2;
    return [[C0 / det, -(b * i - c * h) / det, (b * f - c * e) / det], [C1 / det, (a * i - c * g) / det, -(a * f - c * d) / det],
            [C2 / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
  }
  function usvSimulate(scn, ic) {
    var P = USV_P, H = 0.001, every = 20, N1 = 3, N = 2, t1 = 5, tf = scn.tf, obs = scn.obs;
    var dbar = obs ? 2.8 : 0.8, e = 0.8, hi = obs ? 0.32 : 0.032, k0 = 0.8, ref = USV_REF[scn.ref];
    var M = [[P.m11, 0, 0], [0, P.m22, P.m23], [0, P.m32, P.m33]], Mi = m3inv(M);
    var eta1 = ic.slice(), eta2 = [0, 0, 0], tau = [0, 0, 0], uav = [0, 0, 0], beta = [0, 0, 0];
    var rec = { t: [], pos: [], ref: [], err: [], tau: [] }, nSteps = Math.round(scn.T / H);
    for (var k = 0; k <= nSteps; k++) {
      var t = k * H, rd = ref(t), ed = rd[0], edd = rd[1], eddd = rd[2];
      var c = Math.cos(eta1[2]), s = Math.sin(eta1[2]);
      var R = [[c, -s, 0], [s, c, 0], [0, 0, 1]], Rt = [[c, s, 0], [-s, c, 0], [0, 0, 1]];
      var u = eta2[0], v = eta2[1], r = eta2[2];
      var D = [[-P.Xu - P.Xuu * Math.abs(u), 0, 0],
               [0, -P.Yv - P.Yvv * Math.abs(v) - P.Yrv * Math.abs(r), -P.Yr - P.Yvr * Math.abs(v) - P.Yrr * Math.abs(r)],
               [0, -P.Nv - P.Nvv * Math.abs(v) - P.Nrv * Math.abs(r), -P.Nr - P.Nvr * Math.abs(v) - P.Nrr * Math.abs(r)]];
      var Cm = [[0, 0, -P.m22 * v - P.m23 * r], [0, 0, P.m11 * u], [P.m22 * v + P.m23 * r, -P.m11 * u, 0]];
      var CD = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) CD[a][b] = Cm[a][b] + D[a][b];
      var Seta = [-r * eta2[1], r * eta2[0], 0];
      var cdTerm = m3v(R, m3v(Mi, m3v(CD, m3v(Rt, eta2))));
      var f = [Seta[0] - cdTerm[0], Seta[1] - cdTerm[1], Seta[2] - cdTerm[2]];
      var d1 = 1.3 + 2 * Math.sin(0.02 * t) + 1.5 * Math.sin(0.1 * t) * 0.05;
      var d2 = -0.9 + 2 * Math.sin(0.02 * t - Math.PI / 6) + 1.5 * Math.sin(0.3 * t) * 0.05;
      var d3 = -Math.sin(0.09 * t + Math.PI / 3) - 4 * Math.sin(0.01 * t) * 0.02;
      var dtt = [0.1 * d1, 0.1 * d2, 0.1 * d3];
      var RMt = m3v(R, m3v(Mi, tau));
      var eta2dot = [], j;
      for (j = 0; j < 3; j++) eta2dot.push(f[j] + (obs ? 0.1 * cdTerm[j] : 0) + RMt[j] + dtt[j]);
      var e1 = [eta1[0] - ed[0], eta1[1] - ed[1], eta1[2] - ed[2]], e2 = [eta2[0] - edd[0], eta2[1] - edd[1], eta2[2] - edd[2]];
      if (k % every === 0) {
        rec.t.push(t); rec.pos.push(eta1.slice()); rec.ref.push(ed.slice()); rec.err.push(e1.slice()); rec.tau.push(tau.slice());
      }
      var y = [0, 0, 0], yd = [0, 0, 0], z = [0, 0, 0], zd = [0, 0, 0], si = [], sv = [];
      for (j = 0; j < 3; j++) {
        if (t < tf - 0.02) { y[j] = -N1 / (tf - t) * e1[j]; yd[j] = (-N1 * (tf - t) * e2[j] - N1 * e1[j]) / ((tf - t) * (tf - t)); }
        sv.push(e2[j] - y[j]);
        if (t < t1 - H / 2) { z[j] = -sv[j]; zd[j] = -N / (t1 - t) * z[j]; }   // A recomputed each step, as in the code
        si.push(sv[j] + z[j]);
      }
      var dhat = obs ? [beta[0] + k0 * eta2[0], beta[1] + k0 * eta2[1], beta[2] + k0 * eta2[2]] : dtt;
      var inner = [], uavd = [];
      for (j = 0; j < 3; j++) {
        inner.push(-f[j] + eddd[j] + yd[j] - zd[j] - dhat[j]);
        uavd.push((-uav[j] + (dbar + e) * Math.tanh(100 * si[j])) / hi);
      }
      var MRt = function (w) { return m3v(M, m3v(Rt, w)); };
      var tau1 = MRt(inner), tau2 = MRt(uav);
      var tauN = [tau1[0] - tau2[0], tau1[1] - tau2[1], tau1[2] - tau2[2]];
      if (obs) {
        var RMtn = m3v(R, m3v(Mi, tauN));
        for (j = 0; j < 3; j++) beta[j] += (-k0 * beta[j] - k0 * (f[j] + RMtn[j] + k0 * eta2[j])) * H;
      }
      for (j = 0; j < 3; j++) { eta1[j] += eta2[j] * H; eta2[j] += eta2dot[j] * H; uav[j] += uavd[j] * H; }
      tau = tauN;
    }
    return rec;
  }

  function drawShip(ctx, x, y, a, size, color, halo) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(size * 1.3, 0); ctx.lineTo(size * 0.4, -size * 0.55); ctx.lineTo(-size, -size * 0.55);
    ctx.lineTo(-size, size * 0.55); ctx.lineTo(size * 0.4, size * 0.55); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = halo; ctx.stroke();
    ctx.restore();
  }
  function initUSV(root) {
    var cv = root.querySelector('canvas.pf-main'), cvA = root.querySelector('canvas.pf-chart-r'), cvB = root.querySelector('canvas.pf-chart-xi');
    var out = root.querySelector('.pf-readout'), leg = root.querySelector('.pf-legend'), rowS = root.querySelector('.tt-scn'), desc = root.querySelector('.tt-desc');
    var btnPlay = root.querySelector('[data-act="play"]');
    var COL = ['#c026d3', '#ea580c'], si = 0, runs = null, scn = null, t = 0, hold = 0, view = null, frame = 0, anim = null;
    function reset() {
      scn = USV_SCN[si];
      runs = scn.cases.map(function (c) { return usvSimulate(scn, c.ic); });
      t = 0; hold = 0; view = null;
      var items = [{ color: '#2563eb', label: 'reference η<sub>d</sub>(t)' }];
      scn.cases.forEach(function (c, k) { items.push({ color: COL[k], label: scn.cases.length > 1 ? c.label : 'vessel' }); });
      legend(leg, items);
      desc.innerHTML = scn.desc;
    }
    function build() {
      rowS.innerHTML = '';
      USV_SCN.forEach(function (s, j) {
        var b = document.createElement('button'); b.innerHTML = s.label; if (j === si) b.className = 'on';
        b.addEventListener('click', function () { si = j; build(); }); rowS.appendChild(b);
      });
      reset(); if (anim) anim.kick();
    }
    function idx() { return Math.min(runs[0].t.length - 1, Math.floor(t / 0.02)); }
    function draw() {
      var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h, th = theme(), r0 = runs[0];
      if (!view || view.w !== w || view.h !== h) {
        var pts = r0.ref.slice(); runs.forEach(function (r) { pts = pts.concat(r.pos.slice(0, Math.round((scn.tf + 2) / 0.02))); });
        view = fitView(pts, w, h, 30);
      }
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (var gy = 0; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
      var i = idx(), last = r0.t.length - 1;
      // whole reference (faint) and the part already swept
      ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(37,99,235,0.35)'; ctx.lineWidth = 1.5; polyline(ctx, view, r0.ref, last); ctx.setLineDash([]);
      ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2.5; polyline(ctx, view, r0.ref, i);
      var conv = r0.t[i] >= scn.tf;
      runs.forEach(function (r, k) {
        ctx.strokeStyle = COL[k]; ctx.lineWidth = 2; polyline(ctx, view, r.pos, i);
        var s0 = view.f(r.pos[0][0], r.pos[0][1]); ctx.fillStyle = COL[k]; ctx.fillRect(s0[0] - 4, s0[1] - 4, 8, 8);
        var q = view.f(r.pos[i][0], r.pos[i][1]), q2 = view.f(r.pos[i][0] + Math.cos(r.pos[i][2]), r.pos[i][1] + Math.sin(r.pos[i][2]));
        drawShip(ctx, q[0], q[1], Math.atan2(q2[1] - q[1], q2[0] - q[0]), 10, COL[k], th.halo);
      });
      var rq = view.f(r0.ref[i][0], r0.ref[i][1]);
      ctx.beginPath(); ctx.arc(rq[0], rq[1], conv ? 5 : 7, 0, 7); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = th.muted; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('t = ' + fmt(r0.t[i], 1) + ' s' + (r0.t[i] > scn.tf + 3 ? '  (fast-forward)' : ''), 12, 10);
      if (conv) {
        ctx.textAlign = 'right'; ctx.fillStyle = '#16a34a'; ctx.font = '600 13px Inter, sans-serif';
        ctx.fillText('on the reference from t = t_f = ' + scn.tf + ' s', w - 12, 10);
      }
    }
    function charts() {
      var r0 = runs[0], i = idx(), T = Math.min(r0.t[r0.t.length - 1], Math.max(2 * scn.tf, 20));
      var e0 = 0; runs.forEach(function (r) { e0 = Math.max(e0, Math.hypot(r.err[0][0], r.err[0][1])); });
      var sA = [], sB = [], pm = 0;
      runs.forEach(function (r, k) {
        var a = [], b = [];
        for (var j = 0; j <= i && r.t[j] <= T; j += 2) { a.push([r.t[j], Math.hypot(r.err[j][0], r.err[j][1])]); b.push([r.t[j], r.err[j][2] / DEG]); pm = Math.max(pm, Math.abs(r.err[j][2] / DEG)); }
        sA.push({ color: COL[k], pts: a }); sB.push({ color: COL[k], pts: b });
      });
      var pmax = 0; runs.forEach(function (r) { r.err.forEach(function (e, j) { if (r.t[j] <= T) pmax = Math.max(pmax, Math.abs(e[2] / DEG)); }); });
      drawChart(cvA, 'position error ‖(x̃, ỹ)‖', 'm', T, 0, Math.ceil(e0 * 1.1), sA, Math.min(r0.t[i], T));
      drawChart(cvB, 'heading error ψ̃', 'deg', T, -Math.ceil(pmax * 1.1), Math.ceil(pmax * 1.1), sB, Math.min(r0.t[i], T));
      [cvA, cvB].forEach(function (c) {
        var fc = fitCanvas(c), x = 38 + (fc.w - 46) * scn.tf / T, g = fc.ctx;
        g.strokeStyle = 'rgba(22,163,74,0.7)'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(x, 18); g.lineTo(x, fc.h - 18); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#16a34a'; g.font = '10px Inter, sans-serif'; g.textAlign = 'left'; g.fillText('t_f = ' + scn.tf + ' s', x + 3, 26);
      });
      var html = '<div><span>time</span><b>' + fmt(r0.t[i], 1) + ' s</b></div><div><span>chosen t<sub>f</sub></span><b>' + scn.tf + ' s</b></div>';
      runs.forEach(function (r, k) {
        html += '<div><span>' + (runs.length > 1 ? 'case ' + (k + 1) + ' ' : '') + 'error ‖(x̃, ỹ)‖</span><b style="color:' + COL[k] + '">' +
          (Math.hypot(r.err[i][0], r.err[i][1]) < 1e-3 ? '0.000' : fmt(Math.hypot(r.err[i][0], r.err[i][1]), 3)) + ' m</b></div>';
      });
      out.innerHTML = html;
    }
    anim = animator(root, function (dt) {
      var tEnd = runs[0].t[runs[0].t.length - 1];
      if (t >= tEnd) { hold += dt; if (hold > 2.5) { t = 0; hold = 0; } }
      else t = Math.min(tEnd, t + dt * (t < scn.tf + 3 ? 1.5 : 12));
      draw(); if (frame++ % 3 === 0) charts();
    });
    root.querySelector('[data-act="reset"]').addEventListener('click', function () { t = 0; hold = 0; anim.kick(); });
    btnPlay.addEventListener('click', function () { anim.paused = !anim.paused; btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause'; anim.kick(); });
    btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause';
    build();
  }

/*
 * Asymmetric barrier-Lyapunov backstepping (BLF) trajectory tracking of a
 * Pelican quadrotor -- faithful port of the MATLAB code "Working codes/main.m"
 * (+ initialization.m, desired_trajectory.m, quadrotordynamics.m,
 * control_bounds.m) used for the JGCD paper "Three-dimensional Trajectory
 * Tracking for Unmanned Aerial Vehicles Under Motion Constraints".
 *
 * Reproduced exactly as in the MATLAB code (including its quirks):
 *  - outer loop step h = 1e-3 s, zero-order hold on the inputs; inside each
 *    step the plant is integrated with MATLAB's ode45 algorithm (Dormand-Prince
 *    5(4), RelTol 1e-3, AbsTol 1e-6, MaxStep = 0.1*h, MATLAB's initial-step
 *    and step-adaptation rules);
 *  - stabilising function alpha = r_dot - [q(kb^2-z1^2)+(1-q)(ka^2-z1^2)] k1 z1^3
 *    with q taken from the sign of the PREVIOUS step's error, and r_dot,
 *    alpha_dot obtained by backward finite differences;
 *  - desired roll/pitch: phid = asin(ux sin psid - uy cos psid),
 *    thetad = asin(ux cos psid + uy sin psid) / cos(phid);
 *  - the x/y channels' lower-bound term uses (ka^2 - z1^3) (a typo in main.m,
 *    kept on purpose);  ux, uy use the thrust BEFORE saturation;
 *  - saturation |uT| <= 3*umax = 15 N, |u_phi|,|u_theta|,|u_psi| <= umax = 5 N m;
 *  - rotor-speed term wr from inv(T)*[uT;M] (C_Q = 3.2320 as in the code), the
 *    controller using the previous step's wr;
 *  - translational drag K_x = K_y = K_z = 1 in plant and controller.
 *
 * ES5, no dependencies.  qblfSimulate(scn) returns a recording sampled every
 * scn.rec seconds (default 0.02 s).
 */

var QBLF_SCN = [
  {
    id: 'orbital',
    label: 'Orbital path',
    desc: 'Orbit x_d = 1 + (1 - e^{-3t^3}) cos t, y_d = 2 + (1 - e^{-5t^3}) sin t, z_d = 0.1 + 0.1 sin t m from (1, 2, -0.01) m, psi(0) = 0.1 rad, with error bounds -2.2/+0.2 m (x), -2.3/+0.3 m (y), -0.4/+0.2 m (z), gains K = 100, M = 5, for 20 s.',
    traj: 'orbital',
    k1: [100, 100, 100, 100, 100, 100],
    k2: [5, 5, 5, 5, 5, 5],
    kb: [0.2, 0.3, 0.2, 0.23, 0.20, 0.2],   // upper bounds (error > 0)
    ka: [2.2, 2.3, 0.4, 0.08, 0.11, 0.2],   // lower bounds (error < 0)
    x0: [1, 2, -0.01, 0, 0, 0.1],
    v0: [0, 0, 0, 0, 0, 0],
    drag: [1, 1, 1],
    umax: 5,
    tend: 20, h: 1e-3, rec: 0.02,
    dist: null
  },
  {
    id: 'helix',
    label: 'Helical path',
    desc: 'Climbing helix x_d = 1 + (1 - e^{-3t^3}) cos t, y_d = 2 + (1 - e^{-5t^3}) sin t, z_d = 0.1 + t/50 m from (1, 2, -0.01) m, psi(0) = 0.1 rad, with error bounds -2.2/+0.2 m (x), -2.3/+0.3 m (y), -0.6/+0.2 m (z), gains K = 100, M = 5, for 20 s.',
    traj: 'helix',
    k1: [100, 100, 100, 100, 100, 100],
    k2: [5, 5, 5, 5, 5, 5],
    kb: [0.2, 0.3, 0.2, 0.23, 0.20, 0.2],
    ka: [2.2, 2.3, 0.6, 0.08, 0.11, 0.2],
    x0: [1, 2, -0.01, 0, 0, 0.1],
    v0: [0, 0, 0, 0, 0, 0],
    drag: [1, 1, 1],
    umax: 5,
    tend: 20, h: 1e-3, rec: 0.02,
    dist: null
  },
  {
    id: 'bow',
    label: 'Bow-shaped path',
    desc: 'Bow curve x_d = 1 + (1 - e^{-3t^3}) cos t, y_d = 2 + (1 - e^{-5t^3}) sin t cos t, z_d = 0.1 + 0.1 cos t m from (1, 2, -0.01) m, psi(0) = 0.1 rad, with error bounds -2.2/+0.2 m (x), -1.3/+0.3 m (y), -0.4/+0.2 m (z), -0.25/+0.20 rad (roll), gains K = 100, M = 5, for 20 s.',
    traj: 'bow',
    k1: [100, 100, 100, 100, 100, 100],
    k2: [5, 5, 5, 5, 5, 5],
    kb: [0.2, 0.3, 0.2, 0.20, 0.20, 0.2],
    ka: [2.2, 1.3, 0.4, 0.25, 0.11, 0.2],
    x0: [1, 2, -0.01, 0, 0, 0.1],
    v0: [0, 0, 0, 0, 0, 0],
    drag: [1, 1, 1],
    umax: 5,
    tend: 20, h: 1e-3, rec: 0.02,
    dist: null
  },
  {
    id: 'gust',
    label: 'Orbital path + gust',
    desc: 'Orbital path as above with a 2.5 N push along inertial x from t = 6 s to 6.5 s, using the gains of the stored comparison run (K = 5, M = 10/25/5 for x/y/z, 5 for attitude); the x error and pitch error stay inside -2.2/+0.2 m and -0.11/+0.20 rad, for 20 s.',
    traj: 'orbital',
    // values of Comparision_MAT_files/BLF_comp.mat (the run behind the paper's
    // comparison figures); the paper text says K = 100, M = 5 and 1.358 N
    k1: [5, 5, 5, 5, 5, 5],
    k2: [10, 25, 5, 5, 5, 5],
    kb: [0.2, 0.3, 0.2, 0.23, 0.20, 0.2],
    ka: [2.2, 2.3, 0.4, 0.08, 0.11, 0.2],
    x0: [1, 2, -0.01, 0, 0, 0.1],
    v0: [0, 0, 0, 0, 0, 0],
    drag: [1, 1, 1],
    umax: 5,
    tend: 20, h: 1e-3, rec: 0.02,
    // acceleration added to x_ddot for t0 <= t <= t1 (2.5/m, m = 0.485)
    dist: { t0: 6, t1: 6.5, a: [2.5 / 0.485, 0, 0] }
  }
];

function qblfRef(traj, t) {
  var e3 = 1 - Math.exp(-3 * t * t * t), e5 = 1 - Math.exp(-5 * t * t * t);
  var c = Math.cos(t), s = Math.sin(t);
  if (traj === 'helix') return [1 + e3 * c, 2 + e5 * s, 0.1 + t / 50];
  if (traj === 'bow') return [1 + e3 * c, 2 + e5 * s * c, 0.1 + 0.1 * c];
  return [1 + e3 * c, 2 + e5 * s, 0.1 + 0.1 * s];           // orbital
}

function qblfSimulate(scn) {
  // ---- Pelican data (main.m / quadrotordynamics.m) ----
  var g = 9.81, m = 0.485, Jxx = 3.4e-3, Jyy = 3.4e-3, Jzz = 4.7e-3, l = 0.35,
      Jr = 3.4e-5, C_T = 2.9842e-5, C_Q = 3.2320;
  var z1c = (Jyy - Jzz) / Jxx, z2c = Jr / Jxx, z3c = (Jzz - Jxx) / Jyy,
      z4c = Jr / Jyy, z5c = (Jxx - Jyy) / Jzz,
      c1 = 1 / Jxx, c2 = 1 / Jyy, c3 = 1 / Jzz;
  var Kx = scn.drag ? scn.drag[0] : 0, Ky = scn.drag ? scn.drag[1] : 0, Kz = scn.drag ? scn.drag[2] : 0;
  var k1 = scn.k1, k2 = scn.k2, ka = scn.ka, kb = scn.kb, umax = scn.umax;
  var h = scn.h || 1e-3, tend = scn.tend || 20;
  var N = Math.round(tend / h);                    // samples t = 0 : h : tend-h
  var dist = scn.dist;
  // scn.noTypo = true uses (ka^2 - z1^2) in the x/y channels too (only for
  // reproducing older runs; main.m has the z1^3 typo)
  var noTypo = !!scn.noTypo;

  // inv(T) for the rotor-speed term
  var T = [[C_T, C_T, C_T, C_T], [-C_T * l, 0, C_T * l, 0], [0, -C_T * l, 0, C_T * l], [C_Q, -C_Q, C_Q, -C_Q]];
  var Ti = qblfInv4(T);
  function rotorWr(u) {
    var w = [0, 0, 0, 0];
    for (var i = 0; i < 4; i++) {
      w[i] = Math.sqrt(Math.abs(Ti[i][0] * u[0] + Ti[i][1] * u[1] + Ti[i][2] * u[2] + Ti[i][3] * u[3]));
    }
    return w[0] - w[1] + w[2] - w[3];
  }

  // ---- plant (quadrotordynamics.m); state [x xd y yd z zd phi phid th thd psi psid]
  var uT = 0, uP = 0, uQ = 0, uR = 0, wrP = 0;
  function f(t, X, out) {
    var phi = X[6], th = X[8], psi = X[10];
    var cph = Math.cos(phi), sph = Math.sin(phi), cth = Math.cos(th), sth = Math.sin(th),
        cps = Math.cos(psi), sps = Math.sin(psi);
    var dx = 0, dy = 0, dz = 0;
    if (dist && (dist.strict ? (t > dist.t0 && t < dist.t1) : (t >= dist.t0 && t <= dist.t1))) { dx = dist.a[0]; dy = dist.a[1]; dz = dist.a[2]; }
    var a = uT / m;
    out[0] = X[1];
    out[1] = a * (cph * sth * cps + sph * sps) - Kx * X[1] / m + dx;
    out[2] = X[3];
    out[3] = a * (cph * sth * sps - sph * cps) - Ky * X[3] / m + dy;
    out[4] = X[5];
    out[5] = a * (cph * cth) - g - Kz * X[5] / m + dz;
    out[6] = X[7];
    out[7] = z1c * X[9] * X[11] - z2c * wrP * X[9] + c1 * uP;
    out[8] = X[9];
    out[9] = z3c * X[7] * X[11] + z4c * wrP * X[7] + c2 * uQ;
    out[10] = X[11];
    out[11] = z5c * X[7] * X[9] + c3 * uR;
  }

  // ---- ode45 (MATLAB algorithm) over [t0, tf], returns y(tf) in y ----
  var B = [
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]
  ];
  var A = [1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
  var E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];
  var K = [], i, j;
  for (i = 0; i < 7; i++) K.push(new Float64Array(12));
  var ytmp = new Float64Array(12), ynew = new Float64Array(12);
  var rtol = 1e-3, atol = 1e-6, thr = atol / rtol, pw = 1 / 5;
  var stats = { steps: 0, fails: 0, fevals: 0 };
  function eps(x) { x = Math.abs(x); if (x === 0) return 4.9e-324; var e = Math.floor(Math.log(x) / Math.LN2); if (Math.pow(2, e) > x) e--; if (Math.pow(2, e + 1) <= x) e++; return Math.pow(2, e - 52); }
  function ode45(t0, tf, y) {
    var span = tf - t0, hmax = 0.1 * span, t = t0;
    f(t, y, K[0]); stats.fevals++;
    var hmin = 16 * eps(t), absh = Math.min(hmax, span), rh = 0, v;
    for (i = 0; i < 12; i++) { v = Math.abs(K[0][i]) / Math.max(Math.abs(y[i]), thr); if (v > rh) rh = v; }
    rh = rh / (0.8 * Math.pow(rtol, pw));
    if (absh * rh > 1) absh = 1 / rh;
    absh = Math.max(absh, hmin);
    var done = false;
    while (!done) {
      hmin = 16 * eps(t);
      absh = Math.min(hmax, Math.max(hmin, absh));
      var hh = absh;
      if (1.1 * absh >= Math.abs(tf - t)) { hh = tf - t; absh = Math.abs(hh); done = true; }
      var nofailed = true, err, tnew;
      for (;;) {
        for (var s = 0; s < 5; s++) {
          var bs = B[s];
          for (i = 0; i < 12; i++) {
            var acc = 0;
            for (j = 0; j <= s; j++) acc += bs[j] * K[j][i];
            ytmp[i] = y[i] + hh * acc;
          }
          f(t + hh * A[s], ytmp, K[s + 1]); stats.fevals++;
        }
        tnew = t + hh;
        if (done) tnew = tf;
        hh = tnew - t;
        var b6 = B[5];
        for (i = 0; i < 12; i++) {
          ynew[i] = y[i] + hh * (b6[0] * K[0][i] + b6[2] * K[2][i] + b6[3] * K[3][i] + b6[4] * K[4][i] + b6[5] * K[5][i]);
        }
        f(tnew, ynew, K[6]); stats.fevals++;
        err = 0;
        for (i = 0; i < 12; i++) {
          var fe = 0;
          for (j = 0; j < 7; j++) fe += K[j][i] * E[j];
          v = Math.abs(fe) / Math.max(Math.max(Math.abs(y[i]), Math.abs(ynew[i])), thr);
          if (v > err) err = v;
        }
        err = absh * err;
        if (err > rtol) {
          stats.fails++;
          if (absh <= hmin) { done = true; break; }   // MATLAB would warn and stop
          if (nofailed) { nofailed = false; absh = Math.max(hmin, absh * Math.max(0.1, 0.8 * Math.pow(rtol / err, pw))); }
          else absh = Math.max(hmin, 0.5 * absh);
          hh = absh; done = false;
        } else break;
      }
      stats.steps++;
      if (nofailed) { var tmp = 1.25 * Math.pow(err / rtol, pw); if (tmp > 0.2) absh = absh / tmp; else absh = 5 * absh; }
      t = tnew;
      for (i = 0; i < 12; i++) { y[i] = ynew[i]; K[0][i] = K[6][i]; }
    }
  }

  // ---- reference r (positions precomputed on the grid; psid = 0) ----
  // arrays indexed k = 0..N-1  (MATLAB kk = k+1)
  var r = [], rp = [0, 0, 0, 0, 0, 0];
  for (var k = 0; k < N; k++) {
    var p = qblfRef(scn.traj, k * h);
    r.push([p[0], p[1], p[2], 0, 0, 0]);
  }
  var x1 = scn.x0.slice(), x2 = scn.v0.slice();
  var z1 = [], z2 = [], alpha = [0, 0, 0, 0, 0, 0], dalpha = [0, 0, 0, 0, 0, 0];
  for (i = 0; i < 6; i++) { z1[i] = x1[i] - r[0][i]; z2[i] = x2[i] - alpha[i]; }
  var wr = 0;
  var lower = [], upper = [];
  for (i = 0; i < 6; i++) { lower.push(-ka[i]); upper.push(kb[i]); }

  var every = Math.max(1, Math.round((scn.rec || 0.02) / h));
  var rec = {
    scenario: scn.id, dt: every * h, h: h,
    t: [], pos: [], ref: [], eul: [], eulRef: [], ePos: [], eOri: [],
    lower: [], upper: [], uT: [], M: [],
    boundsConst: { lower: lower, upper: upper },
    complexAsin: 0, maxRatio: [0, 0, 0, 0, 0, 0]
  };
  var Y = new Float64Array(12), q = [0, 0, 0, 0, 0, 0];
  // BLF term z1*[q/(kb^2-z1^2) + (1-q)/(ka^2-z1^2)]
  function bar(i2) { return z1[i2] * (q[i2] / (kb[i2] * kb[i2] - z1[i2] * z1[i2]) + (1 - q[i2]) / (ka[i2] * ka[i2] - z1[i2] * z1[i2])); }
  // same with main.m's x/y typo: (ka^2 - z1^3) in the lower-bound branch
  function barTypo(i2) { return z1[i2] * (q[i2] / (kb[i2] * kb[i2] - z1[i2] * z1[i2]) + (1 - q[i2]) / (ka[i2] * ka[i2] - z1[i2] * z1[i2] * z1[i2])); }

  for (k = 0; k < N - 1; k++) {                         // MATLAB: t1 = 0:h:tend-2h
    var t1 = k * h;
    // ---- q from current error sign ----
    for (i = 0; i < 6; i++) q[i] = z1[i] > 0 ? 1 : 0;
    var phi = x1[3], th = x1[4];
    var thrust = (m / (Math.cos(phi) * Math.cos(th))) * (g + dalpha[2] + Kz * x2[2] / m - k2[2] * z2[2] - bar(2));
    var ux = (m / thrust) * (dalpha[0] + Kx * x2[0] / m - k2[0] * z2[0] - (noTypo ? bar(0) : barTypo(0)));
    var uy = (m / thrust) * (dalpha[1] + Ky * x2[1] / m - k2[1] * z2[1] - (noTypo ? bar(1) : barTypo(1)));
    var psid = r[k][5];
    var s4 = ux * Math.sin(psid) - uy * Math.cos(psid);
    if (Math.abs(s4) > 1) rec.complexAsin++;
    var phid = Math.asin(s4);
    var s5 = ux * Math.cos(psid) + uy * Math.sin(psid);
    if (Math.abs(s5) > 1) rec.complexAsin++;
    var thetad = Math.asin(s5) / Math.cos(phid);
    r[k + 1][3] = phid; r[k + 1][4] = thetad;

    var fphi = z1c * x2[4] * x2[5] - z2c * wr * x2[4];
    var fth = z3c * x2[3] * x2[5] + z4c * wr * x2[3];
    var fpsi = z5c * x2[3] * x2[4];
    var up = Jxx * (-fphi + dalpha[3] - k2[3] * z2[3] - bar(3));
    var uq = Jyy * (-fth + dalpha[4] - k2[4] * z2[4] - bar(4));
    var ur = Jzz * (-fpsi + dalpha[5] - k2[5] * z2[5] - bar(5));
    // control_bounds.m
    if (!(Math.abs(thrust) < 3 * umax)) thrust = 3 * umax * qblfSign(thrust);
    if (!(Math.abs(up) < umax)) up = umax * qblfSign(up);
    if (!(Math.abs(uq) < umax)) uq = umax * qblfSign(uq);
    if (!(Math.abs(ur) < umax)) ur = umax * qblfSign(ur);
    var u4 = [thrust, up, uq, ur];
    wr = rotorWr(u4);                                   // used by controller next step

    // ---- record (state at t1 and the input applied over [t1, t1+h]) ----
    if (k % every === 0) qblfPush(rec, t1, x1, r[k], z1, lower, upper, u4);
    for (i = 0; i < 6; i++) {
      var rr = z1[i] > 0 ? z1[i] / kb[i] : -z1[i] / ka[i];
      if (rr > rec.maxRatio[i]) rec.maxRatio[i] = rr;
    }

    // ---- integrate the plant over [t1, t1+h] ----
    uT = thrust; uP = up; uQ = uq; uR = ur; wrP = wr;
    Y[0] = x1[0]; Y[1] = x2[0]; Y[2] = x1[1]; Y[3] = x2[1]; Y[4] = x1[2]; Y[5] = x2[2];
    Y[6] = x1[3]; Y[7] = x2[3]; Y[8] = x1[4]; Y[9] = x2[4]; Y[10] = x1[5]; Y[11] = x2[5];
    ode45(t1, t1 + h, Y);
    x1 = [Y[0], Y[2], Y[4], Y[6], Y[8], Y[10]];
    x2 = [Y[1], Y[3], Y[5], Y[7], Y[9], Y[11]];

    // ---- backstepping variables for the next step (q of this step) ----
    for (i = 0; i < 6; i++) {
      var zn = x1[i] - r[k + 1][i];
      var rdot = (r[k + 1][i] - r[k][i]) / h;
      var w = q[i] * (kb[i] * kb[i] - zn * zn) + (1 - q[i]) * (ka[i] * ka[i] - zn * zn);
      var an = rdot - w * k1[i] * zn * zn * zn;
      dalpha[i] = (an - alpha[i]) / h;
      alpha[i] = an;
      z1[i] = zn;
      z2[i] = x2[i] - an;
    }
  }
  // last sample (MATLAB leaves the inputs at index N equal to 0)
  if ((N - 1) % every === 0) qblfPush(rec, (N - 1) * h, x1, r[N - 1], z1, lower, upper, [0, 0, 0, 0]);
  rec.stats = stats;
  rec.final = { x1: x1, x2: x2, z1: z1 };
  return rec;
}

function qblfPush(rec, t, x1, rk, z1, lower, upper, u4) {
  rec.t.push(t);
  rec.pos.push([x1[0], x1[1], x1[2]]);
  rec.ref.push([rk[0], rk[1], rk[2]]);
  rec.eul.push([x1[3], x1[4], x1[5]]);
  rec.eulRef.push([rk[3], rk[4], rk[5]]);
  rec.ePos.push([z1[0], z1[1], z1[2]]);
  rec.eOri.push([z1[3], z1[4], z1[5]]);
  rec.lower.push(lower);
  rec.upper.push(upper);
  rec.uT.push(u4[0]);
  rec.M.push([u4[1], u4[2], u4[3]]);
}

function qblfSign(a) { return a > 0 ? 1 : (a < 0 ? -1 : 0); }

function qblfInv4(M) {
  var n = 4, a = [], i, j, k;
  for (i = 0; i < n; i++) { a.push(M[i].slice()); for (j = 0; j < n; j++) a[i].push(i === j ? 1 : 0); }
  for (k = 0; k < n; k++) {
    var p = k;
    for (i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[p][k])) p = i;
    var tmp = a[k]; a[k] = a[p]; a[p] = tmp;
    var d = a[k][k];
    for (j = 0; j < 2 * n; j++) a[k][j] /= d;
    for (i = 0; i < n; i++) if (i !== k) {
      var fct = a[i][k];
      for (j = 0; j < 2 * n; j++) a[i][j] -= fct * a[k][j];
    }
  }
  var inv = [];
  for (i = 0; i < n; i++) inv.push(a[i].slice(n));
  return inv;
}


  /* ── BLF quadrotor animation (#tt-blf) ── */
  var QBLF_DESC = {
    orbital: 'Orbit x<sub>d</sub> = 1 + (1 − e<sup>−3t³</sup>) cos t, y<sub>d</sub> = 2 + (1 − e<sup>−5t³</sup>) sin t, z<sub>d</sub> = 0.1 + 0.1 sin t m, from (1, 2, −0.01) m with ψ(0) = 0.1 rad. Error bounds −2.2/+0.2 m (x), −2.3/+0.3 m (y), −0.4/+0.2 m (z); K = 100, M = 5.',
    helix: 'Climbing helix with the same x<sub>d</sub>, y<sub>d</sub> and z<sub>d</sub> = 0.1 + t/50 m, from (1, 2, −0.01) m. Error bounds −2.2/+0.2 m (x), −2.3/+0.3 m (y), −0.6/+0.2 m (z); K = 100, M = 5.',
    bow: 'Bow-shaped path y<sub>d</sub> = 2 + (1 − e<sup>−5t³</sup>) sin t cos t, z<sub>d</sub> = 0.1 + 0.1 cos t m, from (1, 2, −0.01) m. Error bounds −2.2/+0.2 m (x), −1.3/+0.3 m (y), −0.4/+0.2 m (z), −0.25/+0.20 rad (roll); K = 100, M = 5.',
    gust: 'Orbital path with a 2.5 N push along x from t = 6 s to 6.5 s, with the gains of the comparison run (K = 5, M = 10/25/5 for x/y/z, 5 for attitude). The x and pitch errors are pushed toward their bounds but never cross them.'
  };
  function initBLF(root) {
    var cv = root.querySelector('canvas.pf-main'), cvA = root.querySelector('canvas.pf-chart-r'), cvB = root.querySelector('canvas.pf-chart-xi');
    var out = root.querySelector('.pf-readout'), leg = root.querySelector('.pf-legend'), rowS = root.querySelector('.tt-scn'), desc = root.querySelector('.tt-desc');
    var btnPlay = root.querySelector('[data-act="play"]');
    var si = 1, scn = null, res = null, t = 0, hold = 0, frame = 0, anim = null, view = null, full = null;
    var CH = ['#dc2626', '#2563eb', '#16a34a'];
    legend(leg, [{ color: '#2563eb', label: 'reference' }, { color: '#c026d3', label: 'quadrotor' },
      { color: 'rgba(217,119,6,0.7)', label: 'safe box: error bounds around the reference' }]);
    function reset() {
      scn = QBLF_SCN[si]; res = qblfSimulate(scn); t = 0; hold = 0; view = null;
      full = []; for (var k = 0; k <= 400; k++) full.push(qblfRef(scn.traj, k * scn.tend / 400));
      desc.innerHTML = QBLF_DESC[scn.id] || scn.desc;
    }
    function build() {
      rowS.innerHTML = '';
      QBLF_SCN.forEach(function (s, j) {
        var b = document.createElement('button'); b.textContent = s.label; if (j === si) b.className = 'on';
        b.addEventListener('click', function () { si = j; build(); }); rowS.appendChild(b);
      });
      reset(); if (anim) anim.kick();
    }
    function idx() { return Math.min(res.t.length - 1, Math.floor(t / res.dt)); }
    // orthographic view: azimuth -55 deg, elevation 28 deg, z exaggerated x2
    var AZ = -55 * DEG, EL = 28 * DEG, ZS = 2;
    function P3(p) {
      var x = p[0], y = p[1], z = p[2] * ZS;
      var u = x * Math.cos(AZ) + y * Math.sin(AZ), w = -x * Math.sin(AZ) + y * Math.cos(AZ);
      return [u, z * Math.cos(EL) + w * Math.sin(EL)];
    }
    function draw() {
      var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h, th = theme();
      if (!view || view.w !== w || view.h !== h) {
        var pts = full.map(P3).concat(res.pos.map(P3));
        var b0 = res.boundsConst; pts.push(P3([res.ref[0][0] + b0.upper[0], res.ref[0][1] + b0.upper[1], 0]), P3([res.ref[0][0] + b0.lower[0], res.ref[0][1] + b0.lower[1], 0]));
        view = fitView(pts, w, h, 30);
      }
      function V(p) { var q = P3(p); return view.f(q[0], q[1]); }
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
      var i = idx(), r = res.ref[i], lo = res.lower[i], up = res.upper[i];
      // ground grid at z = 0
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      for (var gx = -2; gx <= 4; gx += 0.5) { var a1 = V([gx, -1, 0]), a2 = V([gx, 5, 0]); ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]); ctx.stroke(); }
      for (var gy = -1; gy <= 5; gy += 0.5) { var b1 = V([-2, gy, 0]), b2 = V([4, gy, 0]); ctx.beginPath(); ctx.moveTo(b1[0], b1[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke(); }
      // safe box around the current reference point
      var X = [r[0] + lo[0], r[0] + up[0]], Y = [r[1] + lo[1], r[1] + up[1]], Z = [r[2] + lo[2], r[2] + up[2]];
      var E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]], C = [];
      for (var a = 0; a < 2; a++) for (var b = 0; b < 2; b++) for (var c = 0; c < 2; c++) C.push(V([X[a], Y[b], Z[c]]));
      ctx.strokeStyle = 'rgba(217,119,6,0.55)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
      E.forEach(function (e) { ctx.beginPath(); ctx.moveTo(C[e[0]][0], C[e[0]][1]); ctx.lineTo(C[e[1]][0], C[e[1]][1]); ctx.stroke(); });
      ctx.setLineDash([]);
      // reference path (full, faint) and swept part
      function line(pts, upto, col, wd, dash) {
        ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.setLineDash(dash || []); ctx.beginPath();
        for (var k = 0; k <= upto && k < pts.length; k++) { var q = V(pts[k]); if (k === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      line(full, full.length - 1, 'rgba(37,99,235,0.35)', 1.5, [5, 5]);
      line(res.ref, i, '#2563eb', 2.2);
      line(res.pos, i, '#c026d3', 2);
      // shadow of the quad on the ground and its drop line
      var p = res.pos[i], g0 = V([p[0], p[1], 0]), pp = V(p);
      ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(pp[0], pp[1]); ctx.stroke();
      // quadrotor: arms rotated by roll/pitch/yaw (small-angle body frame)
      var e = res.eul[i], cph = Math.cos(e[0]), sph = Math.sin(e[0]), cth = Math.cos(e[1]), sth = Math.sin(e[1]), cps = Math.cos(e[2]), sps = Math.sin(e[2]);
      var Rm = [[cth * cps, sph * sth * cps - cph * sps, cph * sth * cps + sph * sps], [cth * sps, sph * sth * sps + cph * cps, cph * sth * sps - sph * cps], [-sth, sph * cth, cph * cth]];
      var L = 0.17;
      [[L, 0, 0], [-L, 0, 0], [0, L, 0], [0, -L, 0]].forEach(function (arm, k) {
        var bw = [Rm[0][0] * arm[0] + Rm[0][1] * arm[1], Rm[1][0] * arm[0] + Rm[1][1] * arm[1], (Rm[2][0] * arm[0] + Rm[2][1] * arm[1])];
        var tip = V([p[0] + bw[0], p[1] + bw[1], p[2] + bw[2]]);
        ctx.strokeStyle = th.text; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(pp[0], pp[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(tip[0], tip[1], 7, 3, 0, 0, 7); ctx.fillStyle = k === 0 ? 'rgba(220,38,38,0.7)' : 'rgba(192,38,211,0.45)'; ctx.fill();
      });
      var rq = V(r); ctx.beginPath(); ctx.arc(rq[0], rq[1], 4, 0, 7); ctx.fillStyle = '#2563eb'; ctx.fill();
      ctx.fillStyle = th.muted; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('t = ' + fmt(res.t[i], 1) + ' s', 12, 10);
      ctx.font = '11px Inter, sans-serif'; ctx.fillText('height exaggerated ×2', 12, h - 20);
    }
    function charts() {
      var i = idx(), T = scn.tend;
      function norm(e, k, j) { return e >= 0 ? e / res.upper[j][k] : -e / res.lower[j][k]; }
      var sA = [0, 1, 2].map(function (k) { var pts = []; for (var j = 0; j <= i; j += 2) pts.push([res.t[j], norm(res.ePos[j][k], k, j)]); return { color: CH[k], pts: pts }; });
      var sB = [0, 1, 2].map(function (k) { var pts = []; for (var j = 0; j <= i; j += 2) pts.push([res.t[j], norm(res.eOri[j][k], k + 3, j)]); return { color: CH[k], pts: pts }; });
      drawChart(cvA, 'position error ÷ bound', '', T, -1.05, 1.05, sA, res.t[i]);
      drawChart(cvB, 'attitude error ÷ bound', '', T, -1.05, 1.05, sB, res.t[i]);
      [cvA, cvB].forEach(function (c) {
        var fc = fitCanvas(c), g = fc.ctx, ph = fc.h - 36;
        function Y(v) { return 18 + ph * (1 - (v + 1.05) / 2.1); }
        g.strokeStyle = 'rgba(217,119,6,0.8)'; g.setLineDash([5, 4]); g.lineWidth = 1.2;
        [1, -1].forEach(function (v) { g.beginPath(); g.moveTo(38, Y(v)); g.lineTo(fc.w - 8, Y(v)); g.stroke(); });
        g.setLineDash([]); g.fillStyle = '#d97706'; g.font = '10px Inter, sans-serif'; g.textAlign = 'right';
        g.fillText('upper bound', fc.w - 10, Y(1) - 3); g.fillText('lower bound', fc.w - 10, Y(-1) + 11);
      });
      var mx = 0; for (var j = 0; j <= i; j++) for (var k = 0; k < 6; k++) mx = Math.max(mx, Math.abs(norm(k < 3 ? res.ePos[j][k] : res.eOri[j][k - 3], k, j)));
      var ep = res.ePos[i];
      out.innerHTML =
        '<div><span>position error</span><b>' + fmt(Math.hypot(ep[0], ep[1], ep[2]) * 100, 1) + ' cm</b></div>' +
        '<div><span>closest approach to a bound</span><b style="color:' + (mx < 1 ? '#16a34a' : '#dc2626') + '">' + fmt(mx * 100, 0) + '% of the bound</b></div>' +
        '<div><span>thrust</span><b>' + fmt(res.uT[i], 2) + ' N</b></div>' +
        '<div><span>attitude (φ, θ)</span><b>' + fmt(res.eul[i][0] / DEG, 1) + '°, ' + fmt(res.eul[i][1] / DEG, 1) + '°</b></div>';
    }
    anim = animator(root, function (dt) {
      var tEnd = res.t[res.t.length - 1];
      if (t >= tEnd) { hold += dt; if (hold > 2.5) { t = 0; hold = 0; } } else t = Math.min(tEnd, t + dt);
      draw(); if (frame++ % 3 === 0) charts();
    });
    root.querySelector('[data-act="reset"]').addEventListener('click', function () { t = 0; hold = 0; anim.kick(); });
    btnPlay.addEventListener('click', function () { anim.paused = !anim.paused; btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause'; anim.kick(); });
    btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause';
    build();
  }

/* quad_ft.js -- faithful port of the MATLAB quadrotor finite-time SMC simulations
 * behind S. Kumar & S.R. Kumar, "Robust Trajectory Tracking of an Uncertain Quadrotor
 * with Almost Global Finite-time Convergence", Proc. IMechE Part G (2025).
 *
 * Source code ported (MATLAB, Quadrotor_finitetime_SAGE/Simulation/):
 *   main_FT.m, main_autopilot.m, quadrotordynamics.m  (top level: helical / circular / lag runs)
 *   Modified Reaching Law/main.m (M2), main_FT.m (M1), TASE_2023.m (C1), Lyapunov_based.m (C2),
 *   Conventional_SMC.m (S1), quadrotordynamics.m (random disturbance), control_bounds.m
 *
 * Integration exactly as in MATLAB: a zero-order-hold control loop with step h, and on each
 * interval [t, t+h] the dynamics are integrated by a line-for-line port of MATLAB's ode45
 * (Dormand-Prince 5(4), RelTol 1e-3, AbsTol 1e-6, MaxStep = 0.1*h, MATLAB's initial-step and
 * step-size rules).  Only Y(end,:) is used, as in the MATLAB scripts.
 *
 * Scenario fields: h, tend, traj, x0 = [x y z phi theta psi] (velocities zero),
 *   model: 'v2022'   dynamics/controller pair that produced the stored 2022 results behind the paper's
 *                    helical / circular / lag figures (identified to 1e-12 from the .mat files):
 *                    phi/theta accelerations l*u/J with commands (J/l)*(...), and z acceleration
 *                    (uT/m) cos(phi) cos(psi);
 *          'current' the quadrotordynamics.m now on disk (u/J and (uT/m) cos(phi) cos(theta));
 *   dist:  'none' | 'zsin' (d_z = 0.1 sin t) | 'sin' (0.1 sin t on all six channels, as the paper text says)
 *          | 'statesin' (d_i = 0.1*state_i*sin t, the commented-out lines of quadrotordynamics.m)
 *          | 'random' (Modified Reaching Law/quadrotordynamics.m: d_xyz ~ U[0, 0.1] m/s^2,
 *            d_angles ~ U[-5, 5] deg/s^2, redrawn at every ode45 function call; seeded RNG here);
 *   lag:   time constant of the first-order input lag (main_autopilot.m), 0 = none;
 *   e0:    'actual' (e(1) = x0 - r(1)) or 'zero' (Modified Reaching Law scripts: initialization.m runs
 *          before the initial condition is written, so e(1) = -r(1));
 *   ctrl[name]: gains; an optional ctrl[name].h overrides the scenario step.
 *
 * Plain ES5, no dependencies.  Usage: var rec = qftSimulate(QFT_SCN[3], 'M2', { seed: 1, dtRec: 0.02 });
 */

/* ------------------------------------------------------------------ scenarios */
var QFT_SCN = [
  {
    id: 'helical',
    label: 'Helical path',
    desc: 'Proposed controller M1 (constant reaching law, beta = 2, kappa = 10, p/q = 15/13) flies from rest at the origin ' +
          '(psi(0) = 0.5 rad) onto the helix x_d = (1-e^{-2t^3})cos t, y_d = (1-e^{-3t^3})sin t, z_d = 2 + t/4 m for 20 s, ' +
          'with thrust capped at 15 N, moments at 5 N m and a 0.1 sin t m/s^2 vertical disturbance.',
    h: 0.01, tend: 20,
    traj: { type: 'helical', ax: 2, ay: 3, z0: 2 },
    x0: [0, 0, 0, 0, 0, 0.5],
    model: 'v2022', dist: 'zsin', lag: 0, e0: 'actual',
    controllers: ['M1'],
    ctrl: { M1: { law: 'M1aes', beta: 2, k: 10, kpsi: 20, p: 15, q: 13 } }
  },
  {
    id: 'circular',
    label: 'Circular path',
    desc: 'Proposed controller M1 (beta = 2, kappa = 10, p/q = 15/13) starts at (0.1, 0.1, 1) m with psi(0) = 0.3 rad and ' +
          'converges onto the unit circle x_d = (1-e^{-2t^3})cos t, y_d = (1-e^{-3t^3})sin t at z_d = 2 m, ' +
          'under a 0.1 sin t m/s^2 vertical disturbance, over 20 s.',
    h: 0.01, tend: 20,
    traj: { type: 'planar', ax: 2, ay: 3, z0: 2 },
    x0: [0.1, 0.1, 1, 0, 0, 0.3],
    model: 'v2022', dist: 'zsin', lag: 0, e0: 'actual',
    controllers: ['M1'],
    ctrl: { M1: { law: 'M1aes', beta: 2, k: 10, kpsi: 20, p: 15, q: 13 } }
  },
  {
    id: 'lag',
    label: 'Circular path with actuator lag',
    desc: 'The circular case with every commanded input passed through a first-order lag 1/(0.1 s + 1) before it reaches ' +
          'the vehicle (inputs start at zero), from (0.1, 0.1, 1) m with psi(0) = 0.3 rad, over 20 s.',
    h: 0.01, tend: 20,
    traj: { type: 'planar', ax: 2, ay: 3, z0: 2 },
    x0: [0.1, 0.1, 1, 0, 0, 0.3],
    model: 'v2022', dist: 'none', lag: 0.1, e0: 'actual',
    controllers: ['M1'],
    ctrl: { M1: { law: 'M1aes', beta: 2, k: 10, kpsi: 10, p: 15, q: 13 } }
  },
  {
    id: 'orbital',
    label: 'Orbital path: M2 vs M1',
    desc: 'Modified reaching law M2 (beta = 2, kappa = 2, alpha0 = 0.5, N = 2, p/q = 15/13) against the constant-reaching-law M1 ' +
          'and two existing finite-time controllers C1 and C2, tracking x_d = (1-e^{-3t^3})cos t, y_d = (1-e^{-5t^3})sin t, ' +
          'z_d = 2 + sin t m from rest at the origin with psi(0) = 0.1 rad, under disturbances 0.1 (state) sin t, for 20 s.',
    h: 0.01, tend: 20,
    traj: { type: 'orbital', ax: 3, ay: 5, z0: 2 },
    x0: [0, 0, 0, 0, 0, 0.1],
    model: 'current', dist: 'statesin', lag: 0, e0: 'zero',
    controllers: ['M2', 'M1'],
    ctrl: {
      /* h = 0.001 for M2 reproduces Table 2 (T_net 465.8158, P_rms 0.4470, Theta_rms 0.0124) and its figure curve */
      M2: { law: 'M2', beta: 2, k: 2, p: 15, q: 13, alpha0: 0.5, N0: 2, P: 2, a1: 10, a2: 10, h: 0.001 },
      /* main_FT.m on disk has k = 10, which diverges here; k = 2 ("identical gains") reproduces the figure curve */
      M1: { law: 'M1', beta: 2, k: 2, p: 15, q: 13, a1: 10, a2: 10 },
      C1: { law: 'C1', c1: 1, eta: 2, k: 0.5, a1: 5, a2: 10 },
      C2: { law: 'C2', k1: 2.5, k2: 0.1 }
    }
  },
  {
    id: 'bow',
    label: 'Bow-shaped path: M2 vs conventional SMC',
    desc: 'Modified reaching law M2 (beta = 2, kappa = 2, alpha0 = 0.5, N = 2) against conventional linear-surface SMC S1 ' +
          '(beta = 1, M = 2) on the bow x_d = 1 + (1-e^{-3t^3})cos t, y_d = 2 + (1-e^{-5t^3})sin t cos t, z_d = 0.5 + 0.5 cos t, ' +
          'starting at (0.5, 1.5, 0) m with psi(0) = 0.5 rad, under random disturbances of up to 0.1 m/s^2 and 5 deg/s^2, for 10 s.',
    h: 0.01, tend: 10,
    traj: { type: 'bow' },
    x0: [0.5, 1.5, 0, 0, 0, 0.5],
    model: 'current', dist: 'random', lag: 0, e0: 'zero',
    controllers: ['M2', 'S1'],
    ctrl: {
      M2: { law: 'M2', beta: 2, k: 2, p: 15, q: 13, alpha0: 0.5, N0: 2, P: 2, a1: 10, a2: 10 },
      S1: { law: 'S1', beta: 1, k: 2, a1: 10, a2: 10 }
    }
  }
];

/* ------------------------------------------------------------------ model constants (as in the .m files) */
var QFT_PAR = (function () {
  var P = { g: 9.81, m: 0.485, Jxx: 3.4e-3, Jyy: 3.4e-3, Jzz: 4.7e-3, l: 0.35, Jr: 3.4e-5, d: 2.9842e-5, ar: 3.2320,
            uTmax: 15, umax: 5 };
  P.z1 = (P.Jyy - P.Jzz) / P.Jxx; P.z2 = P.Jr / P.Jxx; P.z3 = (P.Jzz - P.Jxx) / P.Jyy; P.z4 = P.Jr / P.Jyy;
  P.z5 = (P.Jxx - P.Jyy) / P.Jzz;  /* = 0 (Jxx = Jyy); the dynamics file divides by Jxx, also 0 */
  P.c1 = 1 / P.Jxx; P.c2 = 1 / P.Jyy; P.c3 = 1 / P.Jzz;
  /* inv(T) for T = [d d d d; -d*l 0 d*l 0; 0 -d*l 0 d*l; ar -ar ar -ar] (Gauss-Jordan) */
  var d = P.d, l = P.l, a = P.ar;
  var M = [[d, d, d, d, 1, 0, 0, 0], [-d * l, 0, d * l, 0, 0, 1, 0, 0], [0, -d * l, 0, d * l, 0, 0, 1, 0], [a, -a, a, -a, 0, 0, 0, 1]];
  var i, j, r, c;
  for (c = 0; c < 4; c++) {
    var piv = c, best = Math.abs(M[c][c]);
    for (r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > best) { best = Math.abs(M[r][c]); piv = r; }
    var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
    var dv = M[c][c];
    for (j = 0; j < 8; j++) M[c][j] /= dv;
    for (r = 0; r < 4; r++) if (r !== c) { var f = M[r][c]; for (j = 0; j < 8; j++) M[r][j] -= f * M[c][j]; }
  }
  P.Tinv = [];
  for (i = 0; i < 4; i++) P.Tinv.push([M[i][4], M[i][5], M[i][6], M[i][7]]);
  return P;
})();

/* relative rotor speed wr from the four inputs (W2 = inv(T)*u, W = sqrt|W2|) */
function qftWr(uT, up, ut, us) {
  var Ti = QFT_PAR.Tinv, w = [0, 0, 0, 0], i;
  for (i = 0; i < 4; i++) w[i] = Math.sqrt(Math.abs(Ti[i][0] * uT + Ti[i][1] * up + Ti[i][2] * ut + Ti[i][3] * us));
  return w[0] - w[1] + w[2] - w[3];
}

function qftImul(a, b) {
  if (Math.imul) return Math.imul(a, b);
  var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) | 0);
}
/* seeded uniform RNG (stands in for MATLAB rand; mulberry32) */
function qftRng(seed) {
  var s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = qftImul(t ^ (t >>> 15), t | 1);
    t ^= t + qftImul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ dynamics (quadrotordynamics.m) */
/* y = [x xd y yd z zd phi phid th thd psi psid]; u = [uT uphi utheta upsi, wr];
 * md = { v2022: bool, zsin: bool, rng: function|null }
 *   v2022 = the dynamics that produced the stored 2022 results / paper Figs (helical, circular, lag):
 *           rolling/pitching accelerations l*u/J (not u/J) and z acceleration (uT/m) cos(phi) cos(psi);
 *           identified from Helical_AES1.mat, circular_AES1.mat, autopilot.mat to ~1e-13 per step.
 *   zsin  = d_z = 0.1 sin t (only the z channel), present in the stored helical and circular runs.
 *   rng   = random disturbance of Modified Reaching Law/quadrotordynamics.m, redrawn at every call. */
function qftRhs(t, y, u, md, out) {
  var P = QFT_PAR, dx = 0, dy = 0, dz = 0, dph = 0, dth = 0, dps = 0, rng = md.rng;
  if (md.zsin) dz = 0.1 * Math.sin(t);
  if (md.sin) { var sn = 0.1 * Math.sin(t); dx = sn; dy = sn; dz = sn; dph = sn; dth = sn; dps = sn; }
  if (md.statesin) {  /* commented-out alternative in quadrotordynamics.m: d_i = 0.1*state_i*sin(t) */
    var s1 = 0.1 * Math.sin(t); dx = s1 * y[0]; dy = s1 * y[2]; dz = s1 * y[4]; dph = s1 * y[6]; dth = s1 * y[8]; dps = s1 * y[10];
  }
  if (rng) {
    /* Dist_pos = 0 + (1-0).*rand(3,1); Dist_orien = deg2rad(-5 + 10.*rand(3,1)); d_pos = 0.1*Dist_pos */
    dx = 0.1 * rng(); dy = 0.1 * rng(); dz = 0.1 * rng();
    var k = Math.PI / 180;
    dph = k * (-5 + 10 * rng()); dth = k * (-5 + 10 * rng()); dps = k * (-5 + 10 * rng());
  }
  var ph = y[6], th = y[8], ps = y[10], phd = y[7], thd = y[9], psd = y[11];
  var cph = Math.cos(ph), sph = Math.sin(ph), cth = Math.cos(th), sth = Math.sin(th), cps = Math.cos(ps), sps = Math.sin(ps);
  var a = u[0] / P.m, wr = u[4];
  out[0] = y[1]; out[1] = a * (cph * sth * cps + sph * sps) + dx;
  out[2] = y[3]; out[3] = a * (cph * sth * sps - sph * cps) + dy;
  var arm = md.v2022 ? P.l : 1;
  out[4] = y[5]; out[5] = a * (md.v2022 ? cph * cps : cph * cth) - P.g + dz;
  out[6] = phd;  out[7] = P.z1 * thd * psd - P.z2 * wr * thd + arm * P.c1 * u[1] + dph;
  out[8] = thd;  out[9] = P.z3 * phd * psd + P.z4 * wr * phd + arm * P.c2 * u[2] + dth;
  out[10] = psd; out[11] = P.z5 * phd * thd + P.c3 * u[3] + dps;
}

/* ------------------------------------------------------------------ MATLAB ode45, one call over [t0, tf] */
var QFT_DP = {
  c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
  A: [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9],
      [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
      [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
      [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]],
  E: [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40]
};
function qftEps(x) { /* MATLAB eps(x) for doubles */
  x = Math.abs(x); if (x < 2.2250738585072014e-308) return 4.9406564584124654e-324;
  var e = Math.floor(Math.log(x) / Math.LN2); if (Math.pow(2, e) > x) e--; if (Math.pow(2, e + 1) <= x) e++;
  return Math.pow(2, e - 52);
}
function qftOde45(u, md, t0, tf, y, st) {
  var n = 12, rtol = 1e-3, atol = 1e-6, thr = atol / rtol, pow = 1 / 5;
  var A = QFT_DP.A, Ec = QFT_DP.E, cc = QFT_DP.c;
  var K = st.K, yt = st.yt, ynew = st.ynew, i, j, s;
  var tspan = tf - t0, hmax = 0.1 * Math.abs(tspan), t = t0;
  qftRhs(t, y, u, md, K[0]); st.nf++;
  var hmin = 16 * qftEps(t);
  var absh = Math.min(hmax, Math.abs(tspan));
  var rh = 0;
  for (i = 0; i < n; i++) rh = Math.max(rh, Math.abs(K[0][i]) / Math.max(Math.abs(y[i]), thr));
  rh = rh / (0.8 * Math.pow(rtol, pow));
  if (absh * rh > 1) absh = 1 / rh;
  absh = Math.max(absh, hmin);
  var done = false;
  while (true) {
    hmin = 16 * qftEps(t);
    absh = Math.min(hmax, Math.max(hmin, absh));
    var h = absh;
    if (1.1 * absh >= Math.abs(tf - t)) { h = tf - t; absh = Math.abs(h); done = true; }
    var nofailed = true, err, tnew;
    while (true) {
      for (s = 1; s < 6; s++) {
        for (i = 0; i < n; i++) {
          var acc = 0; for (j = 0; j < s; j++) acc += A[s][j] * K[j][i];
          yt[i] = y[i] + h * acc;
        }
        qftRhs(t + QFT_DP.c[s] * h, yt, u, md, K[s]); st.nf++;
      }
      tnew = t + h; if (done) tnew = tf;
      h = tnew - t;
      for (i = 0; i < n; i++) {
        var b = A[6]; ynew[i] = y[i] + h * (b[0] * K[0][i] + b[2] * K[2][i] + b[3] * K[3][i] + b[4] * K[4][i] + b[5] * K[5][i]);
      }
      qftRhs(tnew, ynew, u, md, K[6]); st.nf++;
      err = 0;
      for (i = 0; i < n; i++) {
        var fe = 0; for (j = 0; j < 7; j++) fe += K[j][i] * Ec[j];
        var sc = Math.max(Math.max(Math.abs(y[i]), Math.abs(ynew[i])), thr);
        err = Math.max(err, Math.abs(fe / sc));
      }
      err = absh * err;
      if (err > rtol) {
        st.nrej++;
        if (absh <= hmin) throw new Error('ode45: step size below hmin at t=' + t);
        if (nofailed) { nofailed = false; absh = Math.max(hmin, absh * Math.max(0.1, 0.8 * Math.pow(rtol / err, pow))); }
        else absh = Math.max(hmin, 0.5 * absh);
        h = absh; done = false;
      } else break;
    }
    st.nstep++;
    if (done) break;
    if (nofailed) { var temp = 1.25 * Math.pow(err / rtol, pow); if (temp > 0.2) absh = absh / temp; else absh = 5 * absh; }
    t = tnew;
    for (i = 0; i < n; i++) y[i] = ynew[i];
    var tk = K[0]; K[0] = K[6]; K[6] = tk;   /* FSAL */
  }
  for (i = 0; i < n; i++) y[i] = ynew[i];
}

/* ------------------------------------------------------------------ reference trajectories */
function qftRef(tr, t) {
  var e = Math.exp, c = Math.cos(t), s = Math.sin(t), t3 = t * t * t;
  if (tr.type === 'bow') return [1 + (1 - e(-3 * t3)) * c, 2 + (1 - e(-5 * t3)) * s * c, 0.5 + 0.5 * c];
  var x = (1 - e(-tr.ax * t3)) * c, y = (1 - e(-tr.ay * t3)) * s;
  if (tr.type === 'helical') return [x, y, tr.z0 + t / 4];
  if (tr.type === 'orbital') return [x, y, tr.z0 + s];
  return [x, y, tr.z0];  /* planar */
}

function qftSgn(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }
function qftFrac(v, a) { return Math.pow(Math.abs(v), a) * qftSgn(v); }  /* |v|^a sign(v) */
function qftSat(v, lim) { return Math.abs(v) < lim ? v : lim * qftSgn(v); }
function qftAsin(v, st) { if (v > 1 || v < -1) { st.asinClip++; v = v > 1 ? 1 : -1; } return Math.asin(v); }

/* ------------------------------------------------------------------ main simulation */
/* scn: an entry of QFT_SCN; controller: a key of scn.ctrl ('M1','M2','C1','C2','S1');
 * opts: { seed (int, default 1), dtRec (s, default 0.02) } */
function qftSimulate(scn, controller, opts) {
  opts = opts || {};
  var t0wall = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  var P = QFT_PAR, C = scn.ctrl[controller];
  if (!C) throw new Error('unknown controller ' + controller + ' for scenario ' + scn.id);
  var law = C.law, h = C.h || scn.h, N = Math.round(scn.tend / h);
  var md = { v2022: scn.model === 'v2022', zsin: scn.dist === 'zsin', sin: scn.dist === 'sin', statesin: scn.dist === 'statesin',
             rng: scn.dist === 'random' ? qftRng(opts.seed == null ? 1 : opts.seed) : null };
  var stride = Math.max(1, Math.round((opts.dtRec || 0.02) / h));
  var i, j, kk;

  /* reference r (N x 6), its finite-difference derivatives, as in the scripts */
  var R = new Float64Array(6 * N), Rd = new Float64Array(6 * N), Rdd = new Float64Array(6 * N);
  for (kk = 0; kk < N; kk++) { var rr = qftRef(scn.traj, kk * h); R[6 * kk] = rr[0]; R[6 * kk + 1] = rr[1]; R[6 * kk + 2] = rr[2]; }

  /* state */
  var y = new Float64Array(12);
  for (i = 0; i < 6; i++) y[2 * i] = scn.x0[i];
  var E = new Float64Array(6), Ed = new Float64Array(6), S = new Float64Array(6), Ns = new Float64Array(6);
  /* e(1,:): 'zero' => initialization.m ran before the IC was written (e = 0 - r), 'actual' => e = x0 - r */
  for (i = 0; i < 6; i++) E[i] = (scn.e0 === 'zero' ? 0 : scn.x0[i]) - R[i];
  var beta = C.beta, pq = C.p / C.q, qp = C.q / C.p;
  if (law === 'M2') {
    for (i = 0; i < 6; i++) {
      S[i] = E[i] + (1 / beta) * qftFrac(Ed[i], pq);
      /* main.m line: Ns(1,:)=alpha_0+(1-alpha_0).*exp(-N_0.*(abs(s)).^P.*sign(s))  (sign(s) only at k = 1) */
      Ns[i] = C.alpha0 + (1 - C.alpha0) * Math.exp(-C.N0 * Math.pow(Math.abs(S[i]), C.P) * qftSgn(S[i]));
    }
  } else if (law === 'S1') {
    for (i = 0; i < 6; i++) S[i] = Ed[i] + beta * E[i];
  } /* M1, M1aes, C1: s = zeros; C2: no surface */

  var st = { K: [], yt: new Float64Array(12), ynew: new Float64Array(12), nf: 0, nstep: 0, nrej: 0, asinClip: 0 };
  for (i = 0; i < 7; i++) st.K.push(new Float64Array(12));
  var uvec = [0, 0, 0, 0, 0], wr = 0, uPrev = [0, 0, 0, 0];

  /* recording */
  var nRec = Math.floor((N - 2) / stride) + 1;
  function cols(m) { var a = []; for (var q = 0; q < m; q++) a.push(new Float64Array(nRec)); return a; }
  var rec = {
    scenario: scn.id, controller: controller, h: h, dt: stride * h, n: nRec,
    t: new Float64Array(nRec), pos: cols(3), ref: cols(3), ang: cols(3), angRef: cols(3),
    ePos: cols(3), eAng: cols(3), ePosNorm: new Float64Array(nRec), eAngNorm: new Float64Array(nRec),
    S: law === 'C2' ? null : cols(6), u: cols(4), metrics: null
  };
  var ir = 0;
  /* metrics, exactly as the scripts: rms over k = 1..N-1, trapz over t with u(N) = 0 */
  var sumP2 = 0, sumO2 = 0, Q = [0, 0, 0, 0], uLast = [0, 0, 0, 0];

  for (kk = 0; kk <= N - 2; kk++) {
    var ph = y[6], th = y[8], ps = y[10], phd = y[7], thd = y[9], psd = y[11];
    var r6 = R[6 * kk + 5];
    var rdd = [Rdd[6 * kk], Rdd[6 * kk + 1], Rdd[6 * kk + 2], Rdd[6 * kk + 3], Rdd[6 * kk + 4], Rdd[6 * kk + 5]];
    var pn = Math.sqrt(E[0] * E[0] + E[1] * E[1] + E[2] * E[2]), on = Math.sqrt(E[3] * E[3] + E[4] * E[4] + E[5] * E[5]);
    sumP2 += pn * pn; sumO2 += on * on;

    if (kk % stride === 0 && ir < nRec) {
      rec.t[ir] = kk * h;
      for (i = 0; i < 3; i++) {
        rec.pos[i][ir] = y[2 * i]; rec.ref[i][ir] = R[6 * kk + i];
        rec.ang[i][ir] = y[6 + 2 * i]; rec.angRef[i][ir] = R[6 * kk + 3 + i];
        rec.ePos[i][ir] = E[i]; rec.eAng[i][ir] = E[3 + i];
      }
      rec.ePosNorm[ir] = pn; rec.eAngNorm[ir] = on;
      if (rec.S) for (i = 0; i < 6; i++) rec.S[i][ir] = S[i];
    }

    var uT, ux, uy, up, ut, us, phdN, thdN, cc = Math.cos(ph) * Math.cos(th), sw, kn = [1, 1, 1, 1, 1, 1];
    if (law === 'M2') for (i = 0; i < 6; i++) kn[i] = C.k / Ns[i];
    else if (law === 'M1' || law === 'M1aes') for (i = 0; i < 6; i++) kn[i] = C.k;

    if (law === 'M2' || law === 'M1') {
      /* Modified Reaching Law/main.m (M2) and main_FT.m (M1): sign(e_dot), tanh(a*s) */
      var ex = 2 - pq;
      uT = P.m / cc * (rdd[2] + P.g - beta * qp * qftFrac(Ed[2], ex) - kn[2] * Math.tanh(C.a1 * S[2]));
      ux = P.m / uT * (rdd[0] - beta * qp * qftFrac(Ed[0], ex) - kn[0] * Math.tanh(C.a1 * S[0]));
      uy = P.m / uT * (rdd[1] - beta * qp * qftFrac(Ed[1], ex) - kn[1] * Math.tanh(C.a1 * S[1]));
      phdN = qftAsin(ux * Math.sin(r6) - uy * Math.cos(r6), st);
      thdN = qftAsin(ux * Math.cos(r6) + uy * Math.sin(r6), st) / Math.cos(phdN);   /* asin(..)/cos, as coded */
      up = -P.Jxx * (P.z1 * thd * psd - P.z2 * wr * thd - rdd[3] + beta * qp * qftFrac(Ed[3], ex) + kn[3] * Math.tanh(C.a2 * S[3]));
      ut = -P.Jyy * (P.z3 * phd * psd + P.z4 * wr * phd - rdd[4] + beta * qp * qftFrac(Ed[4], ex) + kn[4] * Math.tanh(C.a2 * S[4]));
      us = -P.Jzz * (P.z5 * phd * thd - rdd[5] + beta * qp * qftFrac(Ed[5], ex) + kn[5] * Math.tanh(C.a2 * S[5]));
    } else if (law === 'M1aes') {
      /* top-level main_FT.m / main_autopilot.m: |e2|^(2-p/q)*tanh(e2), k*tanh(s), actual psi in phi_d/theta_d */
      var ex2 = 2 - pq;
      var tq = function (v) { return Math.pow(Math.abs(v), ex2) * Math.tanh(v); };
      uT = P.m / cc * (rdd[2] + P.g - beta * qp * tq(Ed[2]) - C.k * Math.tanh(S[2]));
      ux = P.m / uT * (rdd[0] - beta * qp * tq(Ed[0]) - C.k * Math.tanh(S[0]));
      uy = P.m / uT * (rdd[1] - beta * qp * tq(Ed[1]) - C.k * Math.tanh(S[1]));
      phdN = qftAsin(ux * Math.sin(ps) - uy * Math.cos(ps), st);
      thdN = qftAsin((ux * Math.cos(ps) + uy * Math.sin(ps)) / Math.cos(phdN), st);
      up = P.Jxx * (rdd[3] + (P.Jzz - P.Jyy) / P.Jxx * thd * psd + P.Jr / P.Jxx * wr * thd - beta * qp * tq(Ed[3]) - C.k * Math.tanh(S[3]));
      ut = P.Jyy * (rdd[4] + (P.Jxx - P.Jzz) / P.Jyy * phd * psd - P.Jr / P.Jyy * wr * phd - beta * qp * tq(Ed[4]) - C.k * Math.tanh(S[4]));
      us = P.Jzz * (rdd[5] + (P.Jyy - P.Jxx) / P.Jzz * phd * thd - beta * qp * tq(Ed[5]) - (C.kpsi || C.k) * Math.tanh(S[5]));
      /* 2022 runs: rolling/pitching moments commanded as (J/l)*(...) to match the l*u/J dynamics */
      if (md.v2022) { up = up / P.l; ut = ut / P.l; }
    } else if (law === 'C1') {
      /* TASE_2023.m: s = e_dot + c1 e; note +c1*e_dot in the position channels, c1(1) used for y, as coded */
      uT = P.m / cc * (rdd[2] + P.g + C.c1 * Ed[2] - C.eta * Math.tanh(C.a1 * S[2]) - C.k * S[2]);
      ux = P.m / uT * (rdd[0] + C.c1 * Ed[0] - C.eta * Math.tanh(C.a1 * S[0]) - C.k * S[0]);
      uy = P.m / uT * (rdd[1] + C.c1 * Ed[1] - C.eta * Math.tanh(C.a1 * S[1]) - C.k * S[1]);
      phdN = qftAsin(ux * Math.sin(r6) - uy * Math.cos(r6), st);
      thdN = qftAsin((ux * Math.cos(r6) + uy * Math.sin(r6)) / Math.cos(phdN), st);
      up = -P.Jxx * (P.z1 * thd * psd - P.z2 * wr * thd - rdd[3] + C.c1 * Ed[3] + C.eta * Math.tanh(C.a2 * S[3]) + C.k * S[3]);
      ut = -P.Jyy * (P.z3 * phd * psd + P.z4 * wr * phd - rdd[4] + C.c1 * Ed[4] + C.eta * Math.tanh(C.a2 * S[4]) + C.k * S[4]);
      us = -P.Jzz * (P.z5 * phd * thd - rdd[5] + C.c1 * Ed[5] + C.eta * Math.tanh(C.a2 * S[5]) + C.k * S[5]);
    } else if (law === 'C2') {
      /* Lyapunov_based.m: PD-like, actual psi in phi_d/theta_d */
      var g1 = C.k1 * C.k1 - 1, g2 = C.k1 + C.k2;
      uT = P.m / cc * (rdd[2] + P.g - g1 * E[2] - g2 * Ed[2]);
      ux = P.m / uT * (rdd[0] - g1 * E[0] - g2 * Ed[0]);
      uy = P.m / uT * (rdd[1] - g1 * E[1] - g2 * Ed[1]);
      phdN = qftAsin(ux * Math.sin(ps) - uy * Math.cos(ps), st);
      thdN = qftAsin((ux * Math.cos(ps) + uy * Math.sin(ps)) / Math.cos(phdN), st);
      up = -P.Jxx * (P.z1 * thd * psd - P.z2 * wr * thd - rdd[3] + g1 * E[3] + g2 * Ed[3]);
      ut = -P.Jyy * (P.z3 * phd * psd + P.z4 * wr * phd - rdd[4] + g1 * E[4] + g2 * Ed[4]);
      us = -P.Jzz * (P.z5 * phd * thd - rdd[5] + g1 * E[5] + g2 * Ed[5]);
    } else if (law === 'S1') {
      /* Conventional_SMC.m: s = e_dot + beta e */
      uT = P.m / cc * (rdd[2] + P.g - beta * Ed[2] - C.k * Math.tanh(C.a1 * S[2]));
      ux = P.m / uT * (rdd[0] - beta * Ed[0] - C.k * Math.tanh(C.a1 * S[0]));
      uy = P.m / uT * (rdd[1] - beta * Ed[1] - C.k * Math.tanh(C.a1 * S[1]));
      phdN = qftAsin(ux * Math.sin(r6) - uy * Math.cos(r6), st);
      thdN = qftAsin((ux * Math.cos(r6) + uy * Math.sin(r6)) / Math.cos(phdN), st);
      up = -P.Jxx * (P.z1 * thd * psd - P.z2 * wr * thd - rdd[3] + beta * Ed[3] + C.k * Math.tanh(C.a2 * S[3]));
      ut = -P.Jyy * (P.z3 * phd * psd + P.z4 * wr * phd - rdd[4] + beta * Ed[4] + C.k * Math.tanh(C.a2 * S[4]));
      us = -P.Jzz * (P.z5 * phd * thd - rdd[5] + beta * Ed[5] + C.k * Math.tanh(C.a2 * S[5]));
    } else throw new Error('unknown law ' + law);
    R[6 * (kk + 1) + 3] = phdN; R[6 * (kk + 1) + 4] = thdN;

    /* control_bounds.m */
    uT = qftSat(uT, P.uTmax); up = qftSat(up, P.umax); ut = qftSat(ut, P.umax); us = qftSat(us, P.umax);
    /* main_autopilot.m: first-order lag, explicit Euler, inputs zero at k = 1 */
    if (scn.lag > 0) {
      if (kk > 0) {
        uT = uPrev[0] + (uT - uPrev[0]) / scn.lag * h; up = uPrev[1] + (up - uPrev[1]) / scn.lag * h;
        ut = uPrev[2] + (ut - uPrev[2]) / scn.lag * h; us = uPrev[3] + (us - uPrev[3]) / scn.lag * h;
      } else { uT = 0; up = 0; ut = 0; us = 0; }
      uPrev[0] = uT; uPrev[1] = up; uPrev[2] = ut; uPrev[3] = us;
    }
    wr = qftWr(uT, up, ut, us);
    uvec[0] = uT; uvec[1] = up; uvec[2] = ut; uvec[3] = us; uvec[4] = wr;

    if (kk % stride === 0 && ir < nRec) {
      rec.u[0][ir] = uT; rec.u[1][ir] = up; rec.u[2][ir] = ut; rec.u[3][ir] = us; ir++;
    }
    /* trapz(t, u.^2) */
    if (kk > 0) for (i = 0; i < 4; i++) Q[i] += 0.5 * h * (uLast[i] * uLast[i] + uvec[i] * uvec[i]);
    for (i = 0; i < 4; i++) uLast[i] = uvec[i];

    /* ode45 over [t1, t1+h] */
    qftOde45(uvec, md, kk * h, kk * h + h, y, st);

    /* states update, finite-difference reference derivatives, errors, surfaces */
    var k1 = kk + 1;
    for (i = 0; i < 6; i++) {
      Rd[6 * k1 + i] = (R[6 * k1 + i] - R[6 * kk + i]) / h;
      Rdd[6 * k1 + i] = (Rd[6 * k1 + i] - Rd[6 * kk + i]) / h;
      E[i] = y[2 * i] - R[6 * k1 + i];
      Ed[i] = y[2 * i + 1] - Rd[6 * k1 + i];
    }
    if (law === 'M2' || law === 'M1' || law === 'M1aes') {
      for (i = 0; i < 6; i++) S[i] = E[i] + (1 / beta) * qftFrac(Ed[i], pq);
      if (law === 'M2') for (i = 0; i < 6; i++) Ns[i] = C.alpha0 + (1 - C.alpha0) * Math.exp(-C.N0 * Math.pow(Math.abs(S[i]), C.P));
    } else if (law === 'C1') { for (i = 0; i < 6; i++) S[i] = Ed[i] + C.c1 * E[i]; }
    else if (law === 'S1') { for (i = 0; i < 6; i++) S[i] = Ed[i] + beta * E[i]; }
  }
  /* last trapz interval to u(N) = 0 */
  for (i = 0; i < 4; i++) Q[i] += 0.5 * h * (uLast[i] * uLast[i]);
  var t1wall = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  rec.metrics = {
    Tnet: Q[0], Mnet: Math.sqrt(Q[1] * Q[1] + Q[2] * Q[2] + Q[3] * Q[3]),
    Prms: Math.sqrt(sumP2 / (N - 1)), Orms: Math.sqrt(sumO2 / (N - 1)),
    final: { pos: [y[0], y[2], y[4]], ang: [y[6], y[8], y[10]] },
    rhsEvals: st.nf, odeSteps: st.nstep, odeRejected: st.nrej, asinClipped: st.asinClip,
    runtimeMs: t1wall - t0wall
  };
  return rec;
}


  /* ── Finite-time quadrotor animation (#tt-ft) ── */
  var QFT_NAME = { M1: 'proposed, constant reaching law (M1)', M2: 'proposed, modified exponential reaching law (M2)',
    C1: 'existing finite-time controller C1', C2: 'existing finite-time controller C2', S1: 'conventional SMC' };
  var QFT_COL = { M2: '#c026d3', M1: '#16a34a', C1: '#ea580c', C2: '#64748b', S1: '#ea580c' };
  var QFT_DESC = {
    helical: 'Controller M1 (β = 2, κ = 10, p/q = 15/13) takes off from rest at the origin with ψ(0) = 0.5 rad onto the helix x<sub>d</sub> = (1 − e<sup>−2t³</sup>) cos t, y<sub>d</sub> = (1 − e<sup>−3t³</sup>) sin t, z<sub>d</sub> = 2 + t/4 m, with a 0.1 sin t m/s² vertical disturbance.',
    circular: 'Controller M1 starts at (0.1, 0.1, 1) m with ψ(0) = 0.3 rad and converges onto the unit circle at z<sub>d</sub> = 2 m, under a 0.1 sin t m/s² vertical disturbance.',
    lag: 'The circular case with every command passed through a first-order lag 1/(0.1s + 1) before it reaches the vehicle.',
    orbital: 'The two reaching laws: modified exponential law M2 (κ = 2, α<sub>0</sub> = 0.5, 𝒩 = 2) against the constant reaching law M1, on x<sub>d</sub> = (1 − e<sup>−3t³</sup>) cos t, y<sub>d</sub> = (1 − e<sup>−5t³</sup>) sin t, z<sub>d</sub> = 2 + sin t m from rest at the origin, with state-dependent disturbances.',
    bow: 'M2 against conventional linear-surface SMC on the bow path x<sub>d</sub> = 1 + (1 − e<sup>−3t³</sup>) cos t, y<sub>d</sub> = 2 + (1 − e<sup>−5t³</sup>) sin t cos t, z<sub>d</sub> = 0.5 + 0.5 cos t, from (0.5, 1.5, 0) m with random disturbances.'
  };
  function initFT(root) {
    var cv = root.querySelector('canvas.pf-main'), cvA = root.querySelector('canvas.pf-chart-r'), cvB = root.querySelector('canvas.pf-chart-xi');
    var out = root.querySelector('.pf-readout'), leg = root.querySelector('.pf-legend'), rowS = root.querySelector('.tt-scn'), desc = root.querySelector('.tt-desc');
    var btnPlay = root.querySelector('[data-act="play"]');
    var si = 3, scn = null, runs = null, t = 0, hold = 0, frame = 0, anim = null, view = null, full = null;
    var AZ = -55 * DEG, EL = 25 * DEG;
    function P3(p) { var u = p[0] * Math.cos(AZ) + p[1] * Math.sin(AZ), w = -p[0] * Math.sin(AZ) + p[1] * Math.cos(AZ); return [u, p[2] * Math.cos(EL) + w * Math.sin(EL)]; }
    function at(r, key, i) { return [r[key][0][i], r[key][1][i], r[key][2][i]]; }
    function reset() {
      scn = QFT_SCN[si];
      runs = scn.controllers.map(function (c) { return { c: c, r: qftSimulate(scn, c) }; });
      t = 0; hold = 0; view = null;
      full = []; for (var k = 0; k <= 400; k++) full.push(qftRef(scn.traj, k * scn.tend / 400));
      var items = [{ color: '#2563eb', label: 'reference' }];
      runs.forEach(function (x) { items.push({ color: QFT_COL[x.c], label: QFT_NAME[x.c] }); });
      legend(leg, items);
      desc.innerHTML = QFT_DESC[scn.id] || scn.desc;
    }
    function build() {
      rowS.innerHTML = '';
      QFT_SCN.forEach(function (s, j) {
        var b = document.createElement('button'); b.textContent = s.label.replace(/:.*$/, ''); if (j === si) b.className = 'on';
        b.addEventListener('click', function () { si = j; build(); }); rowS.appendChild(b);
      });
      reset(); if (anim) anim.kick();
    }
    function idx() { return Math.min(runs[0].r.n - 1, Math.floor(t / runs[0].r.dt)); }
    function draw() {
      var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h, th = theme(), i = idx();
      if (!view || view.w !== w || view.h !== h) {
        var pts = full.map(P3); runs.forEach(function (x) { for (var j = 0; j < x.r.n; j += 5) pts.push(P3(at(x.r, 'pos', j))); });
        view = fitView(pts, w, h, 30);
      }
      function V(p) { var q = P3(p); return view.f(q[0], q[1]); }
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      for (var g = -2; g <= 4; g += 0.5) {
        var a1 = V([g, -2, 0]), a2 = V([g, 4, 0]), b1 = V([-2, g, 0]), b2 = V([4, g, 0]);
        ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]); ctx.moveTo(b1[0], b1[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
      }
      function line(get, n, col, wd, dash) {
        ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.setLineDash(dash || []); ctx.beginPath();
        for (var k = 0; k <= n; k++) { var q = V(get(k)); if (k === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      line(function (k) { return full[k]; }, full.length - 1, 'rgba(37,99,235,0.35)', 1.5, [5, 5]);
      line(function (k) { return at(runs[0].r, 'ref', k); }, i, '#2563eb', 2.2);
      runs.slice().reverse().forEach(function (x) {
        line(function (k) { return at(x.r, 'pos', k); }, i, QFT_COL[x.c], x.c === 'M2' || runs.length === 1 ? 2.2 : 1.6);
        var p = at(x.r, 'pos', i), pp = V(p), a = at(x.r, 'ang', i);
        var cph = Math.cos(a[0]), sph = Math.sin(a[0]), cth = Math.cos(a[1]), sth = Math.sin(a[1]), cps = Math.cos(a[2]), sps = Math.sin(a[2]);
        var Rm = [[cth * cps, sph * sth * cps - cph * sps], [cth * sps, sph * sth * sps + cph * cps], [-sth, sph * cth]];
        [[0.17, 0], [-0.17, 0], [0, 0.17], [0, -0.17]].forEach(function (arm, k) {
          var tip = V([p[0] + Rm[0][0] * arm[0] + Rm[0][1] * arm[1], p[1] + Rm[1][0] * arm[0] + Rm[1][1] * arm[1], p[2] + Rm[2][0] * arm[0] + Rm[2][1] * arm[1]]);
          ctx.strokeStyle = QFT_COL[x.c]; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(pp[0], pp[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
          ctx.beginPath(); ctx.ellipse(tip[0], tip[1], 6, 2.5, 0, 0, 7); ctx.fillStyle = k === 0 ? 'rgba(220,38,38,0.75)' : th.muted; ctx.fill();
        });
      });
      var rq = V(at(runs[0].r, 'ref', i)); ctx.beginPath(); ctx.arc(rq[0], rq[1], 4, 0, 7); ctx.fillStyle = '#2563eb'; ctx.fill();
      ctx.fillStyle = th.muted; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('t = ' + fmt(runs[0].r.t[i], 1) + ' s', 12, 10);
    }
    function charts() {
      var i = idx(), T = scn.tend, pm = 0, am = 0;
      var sA = runs.map(function (x) { var p = []; for (var j = 0; j <= i; j += 2) { p.push([x.r.t[j], x.r.ePosNorm[j]]); } return { color: QFT_COL[x.c], pts: p }; });
      var sB = runs.map(function (x) { var p = []; for (var j = 0; j <= i; j += 2) { p.push([x.r.t[j], x.r.eAngNorm[j] / DEG]); } return { color: QFT_COL[x.c], pts: p }; });
      runs.forEach(function (x) { for (var j = 0; j < x.r.n; j++) { pm = Math.max(pm, x.r.ePosNorm[j]); am = Math.max(am, x.r.eAngNorm[j] / DEG); } });
      drawChart(cvA, 'position error ‖e‖', 'm', T, 0, Math.ceil(pm * 10) / 10, sA, runs[0].r.t[i]);
      drawChart(cvB, 'attitude error ‖e‖', 'deg', T, 0, Math.ceil(am), sB, runs[0].r.t[i]);
      var html = '<div><span>time</span><b>' + fmt(runs[0].r.t[i], 1) + ' s</b></div>';
      runs.forEach(function (x) {
        html += '<div><span>' + x.c + ' position error now / RMS</span><b style="color:' + QFT_COL[x.c] + '">' + fmt(x.r.ePosNorm[i] * 100, 1) + ' cm / ' + fmt(x.r.metrics.Prms, 3) + ' m</b></div>';
      });
      out.innerHTML = html;
    }
    anim = animator(root, function (dt) {
      var tEnd = runs[0].r.t[runs[0].r.n - 1];
      if (t >= tEnd) { hold += dt; if (hold > 2.5) { t = 0; hold = 0; } } else t = Math.min(tEnd, t + dt);
      draw(); if (frame++ % 3 === 0) charts();
    });
    root.querySelector('[data-act="reset"]').addEventListener('click', function () { t = 0; hold = 0; anim.kick(); });
    btnPlay.addEventListener('click', function () { anim.paused = !anim.paused; btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause'; anim.kick(); });
    btnPlay.textContent = anim.paused ? '▶ Play' : '❚❚ Pause';
    build();
  }

  function init() {
    var a = document.getElementById('pf-sim2d'); if (a) initSim2D(a);
    var b = document.getElementById('pf-sim3d'); if (b) initSim3D(b);
    var c = document.getElementById('pf-sat'); if (c) initSat(c);
    var d = document.getElementById('pf-ct'); if (d) initCT(d);
    var e = document.getElementById('pe-sim'); if (e) initPE(e);
    var m = document.getElementById('pe-multi'); if (m) initPEMulti(m);
    var tr = document.getElementById('pe-tri'); if (tr) initTri(tr);
    var us = document.getElementById('tt-usv'); if (us) initUSV(us);
    var bl = document.getElementById('tt-blf'); if (bl) initBLF(bl);
    var ftq = document.getElementById('tt-ft'); if (ftq) initFT(ftq);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
