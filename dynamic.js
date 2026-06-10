/**
 * dynamic.js — Saurabh Kumar's Website
 * Features: dark/light mode, scroll fade-ins, hero typing + particles, pub filter
 * Compatible with Jemdoc+MathJax. Place in www/
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════
     1. DARK / LIGHT MODE
     ══════════════════════════════════════════════ */
  function initDarkMode() {
    var btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.setAttribute('aria-label', 'Toggle dark/light mode');
    btn.innerHTML = getThemeIcon();

    // Insert before the ☰ button inside #main
    var mainDiv = document.getElementById('main');
    if (mainDiv) {
      mainDiv.insertBefore(btn, mainDiv.firstChild);
    }

    btn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      btn.innerHTML = getThemeIcon();
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('sk-theme', theme); } catch (e) {}
  }

  function getThemeIcon() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      // Sun icon (switch to light)
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    } else {
      // Moon icon (switch to dark)
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    }
  }

  /* ══════════════════════════════════════════════
     2. SCROLL FADE-IN ANIMATIONS
     ══════════════════════════════════════════════ */
  function initScrollAnimations() {
    if (!window.IntersectionObserver) return;

    var selectors = [
      '.res-card',
      '.course-card',
      '.mentor-card',
      '.project-card',
      '.edu-item',
      '#layout-content > h2',
      '#layout-content > p',
      '.pub-page-lists li',
      '.ra-back'
    ];

    var elements = document.querySelectorAll(selectors.join(','));

    // Stagger delay for grid children
    var gridParents = document.querySelectorAll(
      '.research-grid, .teaching-grid, .projects-grid, .mentor-section, .edu-timeline'
    );
    var staggerMap = new Map();
    gridParents.forEach(function (parent) {
      var children = parent.querySelectorAll(selectors.join(','));
      children.forEach(function (child, i) {
        staggerMap.set(child, i);
      });
    });

    elements.forEach(function (el) {
      el.classList.add('sk-fade');
      var idx = staggerMap.get(el);
      if (idx !== undefined) {
        el.style.transitionDelay = Math.min(idx * 0.06, 0.42) + 's';
      }
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('sk-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

    document.querySelectorAll('.sk-fade').forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ══════════════════════════════════════════════
     3. HERO TYPING ANIMATION
     ══════════════════════════════════════════════ */
  function initTypingAnimation() {
    var badge = document.querySelector('.hero-badge');
    if (!badge) return;

    var roles = [
      'Postdoctoral Fellow \u00b7 IIT Bombay',
      'Guidance & Control Researcher',
      'Nonlinear Systems Engineer',
      'Autonomous Vehicles Specialist'
    ];

    var roleIndex = 0;
    var charIndex  = roles[0].length; // start fully typed
    var isDeleting = false;
    var paused     = false;

    function tick() {
      if (paused) return;
      var full = roles[roleIndex];

      if (isDeleting) {
        charIndex--;
        badge.textContent = full.substring(0, charIndex);
      } else {
        charIndex++;
        badge.textContent = full.substring(0, charIndex);
      }

      var delay = isDeleting ? 38 : 75;

      if (!isDeleting && charIndex === full.length) {
        delay = 2400;
        isDeleting = true;
      } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        roleIndex = (roleIndex + 1) % roles.length;
        delay = 350;
      }

      setTimeout(tick, delay);
    }

    // Begin after initial pause so hero entrance animation completes first
    setTimeout(tick, 2800);
  }

  /* ══════════════════════════════════════════════
     4. HERO PARTICLE CANVAS
     ══════════════════════════════════════════════ */
  function initParticles() {
    var hero = document.querySelector('.hero-section');
    if (!hero) return;

    var canvas = document.createElement('canvas');
    canvas.id = 'hero-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    hero.insertBefore(canvas, hero.firstChild);

    // Ensure hero children sit above canvas
    Array.from(hero.children).forEach(function (child) {
      if (child !== canvas) child.style.position = 'relative';
    });

    var ctx = canvas.getContext('2d');
    var particles = [];
    var N = 45;
    var mouse = { x: -9999, y: -9999 };

    function resize() {
      canvas.width  = hero.offsetWidth;
      canvas.height = hero.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    hero.addEventListener('mousemove', function (e) {
      var rect = hero.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });
    hero.addEventListener('mouseleave', function () {
      mouse.x = -9999; mouse.y = -9999;
    });

    for (var i = 0; i < N; i++) {
      particles.push({
        x:     Math.random() * 1200,
        y:     Math.random() * 400,
        r:     Math.random() * 1.6 + 0.5,
        dx:    (Math.random() - 0.5) * 0.35,
        dy:    (Math.random() - 0.5) * 0.35,
        alpha: Math.random() * 0.35 + 0.08
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Lines between nearby particles
      for (var a = 0; a < particles.length; a++) {
        for (var b = a + 1; b < particles.length; b++) {
          var dx = particles[a].x - particles[b].x;
          var dy = particles[a].y - particles[b].y;
          var d  = Math.sqrt(dx * dx + dy * dy);
          if (d < 130) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(147,197,253,' + (0.13 * (1 - d / 130)) + ')';
            ctx.lineWidth = 0.6;
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.stroke();
          }
        }
      }

      // Particles + subtle mouse repulsion
      particles.forEach(function (p) {
        var mdx = p.x - mouse.x;
        var mdy = p.y - mouse.y;
        var md  = Math.sqrt(mdx * mdx + mdy * mdy);
        if (md < 90) {
          var force = (90 - md) / 90 * 0.6;
          p.x += (mdx / md) * force;
          p.y += (mdy / md) * force;
        }

        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0 || p.x > canvas.width)  p.dx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.dy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(147,197,253,' + p.alpha + ')';
        ctx.fill();
      });

      requestAnimationFrame(draw);
    }
    draw();
  }

  /* ══════════════════════════════════════════════
     5. PUBLICATION SECTION FILTERS
     ══════════════════════════════════════════════ */
  function initPubFilters() {
    var container = document.querySelector('.pub-page-lists');
    if (!container) return;

    // Only activate on the main publications page (has 3 h2 sections)
    var h2s = container.querySelectorAll('h2');
    if (h2s.length < 2) return;

    var bar = document.createElement('div');
    bar.className = 'pub-filter-bar';

    // Map filter label → partial match against h2 text
    var filters = [
      { label: 'All',          match: null },
      { label: 'Journals',     match: 'journal' },
      { label: 'Conferences',  match: 'conference' },
      { label: 'Preprints',    match: 'preprint' }
    ];

    filters.forEach(function (f, idx) {
      var btn = document.createElement('button');
      btn.className = 'pub-filter-btn' + (idx === 0 ? ' active' : '');
      btn.textContent = f.label;
      btn.addEventListener('click', function () {
        container.querySelectorAll('.pub-filter-btn').forEach(function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        applyPubFilter(f.match, h2s);
      });
      bar.appendChild(btn);
    });

    container.insertBefore(bar, container.firstChild);
  }

  function applyPubFilter(match, h2s) {
    h2s.forEach(function (h2) {
      var title = h2.textContent.toLowerCase();
      var show  = (match === null) || title.indexOf(match) !== -1;
      var display = show ? '' : 'none';

      h2.style.display = display;
      // Hide/show all siblings until the next h2
      var el = h2.nextElementSibling;
      while (el && el.tagName !== 'H2') {
        el.style.display = display;
        el = el.nextElementSibling;
      }
    });
  }

  /* ══════════════════════════════════════════════
     6. ACTIVE NAV HIGHLIGHT (smooth)
     ══════════════════════════════════════════════ */
  function initNavHighlight() {
    // Jemdoc already sets .current; just ensure smooth indicator
    var current = document.querySelector('.menu-item a.current');
    if (current) {
      current.closest('.menu-item').style.borderLeft = '3px solid var(--accent2)';
    }
  }

  /* ══════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', function () {
    initDarkMode();
    initScrollAnimations();
    initTypingAnimation();
    initParticles();
    initPubFilters();
    initNavHighlight();
  });

})();
