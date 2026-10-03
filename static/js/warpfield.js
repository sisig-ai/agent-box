    /* ================= Warp starfield ================= */
    (() => {
      const canvas = document.getElementById('warpfield');
      // Build stamp: confirm which version the browser actually loaded —
      // DevTools console or `document.documentElement.dataset.bgver`.
      document.documentElement.dataset.bgver = '2026.09.28d';
      console.info('[bg] build 2026.09.28d — sprites, 30fps budget, idle pause');
      const ctx = canvas.getContext('2d', { alpha: true });
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      // A/B probe: append ?freezebg=1 to the dashboard URL to freeze the
      // ENTIRE page — starfield paints one static frame, and every CSS
      // animation/transition on the page is silenced. Whatever GPU% remains
      // with this on provably does not belong to this tab.
      const freeze = new URLSearchParams(location.search).get('freezebg') === '1';
      if (freeze) {
        document.querySelectorAll('.nebula span').forEach(n => { n.style.animation = 'none'; });
        const silencer = document.createElement('style');
        silencer.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
        (document.head || document.documentElement).appendChild(silencer);
        console.info('[bg] FROZEN — canvas, nebula, and all CSS animations/transitions disabled');
        const tag = document.createElement('div');
        tag.textContent = 'bg: FROZEN';
        tag.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99;font:11px ui-monospace,monospace;color:#aa87ff;padding:3px 7px;border:1px solid rgba(170,135,255,.6);border-radius:4px;background:rgba(5,8,20,.8);pointer-events:none';
        document.body.appendChild(tag);
      }

      const COUNT = 700;
      // Raw channel strings only — alpha is baked into the sprites below, so
      // the render loop never builds rgba() strings for the browser to parse.
      const TINTS = ['255,255,255', '213,224,255', '225,210,255', '190,220,255'];
      const WHITE_SHARE = 0.5;   // half the stars stay plain white, as before
      const BUCKETS = 8;         // depth steps shared by sprites and streaks

      let w = 0, h = 0, cx = 0, cy = 0, scale = 0, dpr = 1;
      let stars = [];
      let spriteRow = [];        // [tint * BUCKETS + bucket] -> prerendered glow
      let streakStyle = [];      // cached stroke colour per (tint, bucket) group
      let streakWidth = [];      // cached stroke width per group
      let groups = [];           // reused flat [x1,y1,x2,y2,...] segment buffers
      let speed = 0.1;           // current warp factor
      let target = 0.1;          // eased toward
      const CRUISE = 0.1;
      let raf = 0;
      let idle = false;          // ambient motion paused (no user activity)
      let last = 0;              // timestamp of the last painted frame
      // Paint on a wall-clock budget instead of once per vsync. Cruising stars
      // barely change within 33 ms, and on a 120 Hz display this cuts the
      // full-screen clear + blits + compositing by 4x; warp bursts get 60 fps.
      const CRUISE_MS = 1000 / 30;
      const WARP_MS = 1000 / 60;

      function look(depth) {
        return {
          alpha: Math.min(0.38 + depth * 0.6, 0.96),
          size: 1.1 + depth * 2.4
        };
      }

      // Pre-render every star appearance (tint x depth) into a small offscreen
      // canvas: solid core plus halo baked into one radial gradient. A star is
      // then a single GPU blit per frame instead of one or two string-parsed,
      // antialiased arc fills.
      function buildSprites() {
        spriteRow = [];
        streakStyle = [];
        streakWidth = [];
        groups = [];
        for (let t = 0; t < TINTS.length; t++) {
          const rgb = TINTS[t];
          for (let b = 0; b < BUCKETS; b++) {
            const depth = (b + 0.5) / BUCKETS;
            const { alpha, size } = look(depth);
            const r = size * 1.9;            // outer halo edge
            const css = r * 2 + 3;           // + bleed margin
            const c = document.createElement('canvas');
            c.width = c.height = Math.max(2, Math.ceil(css * dpr));
            const g = c.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            const grad = g.createRadialGradient(css / 2, css / 2, 0, css / 2, css / 2, r);
            const core = (size / 2) / r;     // solid-centre fraction (~0.26)
            grad.addColorStop(0, `rgba(${rgb},${alpha})`);
            grad.addColorStop(core, `rgba(${rgb},${alpha})`);
            grad.addColorStop(Math.min(core + 0.3, 0.9), `rgba(${rgb},${alpha * 0.22})`);
            grad.addColorStop(1, `rgba(${rgb},0)`);
            g.fillStyle = grad;
            g.fillRect(0, 0, css, css);
            spriteRow.push({ c, css, half: css / 2 });

            streakStyle.push(`rgba(${rgb},${alpha})`);
            streakWidth.push(size);
            groups.push([]);
          }
        }
      }

      function resize() {
        // 1x backing store: at DPR 2 this canvas was 4x the pixels of the
        // screen for soft radial glows that upscale cleanly. Halving each
        // dimension quarters the bytes cleared, blitted and composited per
        // frame — the single biggest GPU lever on this page.
        dpr = 1;
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cx = w / 2;
        cy = h / 2;
        // Keep this low: a large scale flings the bright near-stars off-screen
        // almost immediately, leaving only dim far ones visible.
        scale = Math.max(w, h) * 0.32;
        buildSprites();
      }

      function spawn(star, seeded) {
        // Spread across a disc so density stays even as stars fly outward
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random());
        star.x = Math.cos(a) * r;
        star.y = Math.sin(a) * r;
        star.z = seeded ? 0.08 + Math.random() * 0.92 : 1;
        const t = Math.random();
        star.tint = t < WHITE_SHARE ? 0 : 1 + ((t - WHITE_SHARE) * (TINTS.length - 1) | 0);
        return star;
      }

      function init() {
        stars = Array.from({ length: COUNT }, () => spawn({}, true));
      }

      function drawDot(s, x, y, bucket) {
        const sp = spriteRow[s.tint * BUCKETS + bucket];
        ctx.drawImage(sp.c, x - sp.half, y - sp.half, sp.css, sp.css);
      }

      function frame(ts) {
        raf = requestAnimationFrame(frame);
        const warping = speed > 0.2;
        // -4 ms slack so a frame is never dropped for one whole extra vsync
        // tick due to float jitter (e.g. 2 ticks at 120 Hz vs a 16.7 ms budget)
        const elapsed = ts - last;
        if (elapsed < (warping ? WARP_MS : CRUISE_MS) - 4) return;
        last = ts;
        const dt = Math.min(elapsed / 1000, 0.1);

        ctx.clearRect(0, 0, w, h);
        // dt-based easing/motion keeps the feel identical at 30 or 60 fps
        // (0.055 and 0.045 per frame at 60 Hz ≈ 3.3 and 2.7 per second)
        speed += (target - speed) * (1 - Math.exp(-3.3 * dt));
        target += (CRUISE - target) * (1 - Math.exp(-2.7 * dt));  // drift back to cruise

        if (warping) for (const gbuf of groups) gbuf.length = 0;

        for (const s of stars) {
          const prevZ = s.z;
          s.z -= speed * dt;     // 0.016/frame at 60 Hz ≈ 0.96/s; ~same visual pace
          if (s.z <= 0.02) { spawn(s, false); continue; }

          const k = scale / s.z;
          const x = cx + s.x * k;
          const y = cy + s.y * k;
          if (x < -80 || x > w + 80 || y < -80 || y > h + 80) { spawn(s, false); continue; }

          const depth = 1 - s.z;                       // 0 far -> 1 near
          const bucket = Math.min(depth * BUCKETS | 0, BUCKETS - 1);

          // Streak while warping, sprite dot while cruising
          let streaked = false;
          if (warping) {
            const pk = scale / prevZ;
            const px = cx + s.x * pk;
            const py = cy + s.y * pk;
            if ((px - x) ** 2 + (py - y) ** 2 > 1) {
              groups[s.tint * BUCKETS + bucket].push(px, py, x, y);
              streaked = true;
            }
          }
          if (!streaked) drawDot(s, x, y, bucket);
        }

        if (warping) {
          // One batched multi-segment stroke per (tint, depth) group instead
          // of up to COUNT individual beginPath/stroke round-trips.
          ctx.lineCap = 'round';
          for (let gi = 0; gi < groups.length; gi++) {
            const gbuf = groups[gi];
            if (gbuf.length === 0) continue;
            ctx.strokeStyle = streakStyle[gi];
            ctx.lineWidth = streakWidth[gi];
            ctx.beginPath();
            for (let i = 0; i < gbuf.length; i += 4) {
              ctx.moveTo(gbuf[i], gbuf[i + 1]);
              ctx.lineTo(gbuf[i + 2], gbuf[i + 3]);
            }
            ctx.stroke();
          }
        }
      }

      function paintStill() {
        speed = 0;
        ctx.clearRect(0, 0, w, h);
        for (const s of stars) {
          const k = scale / s.z;
          const x = cx + s.x * k, y = cy + s.y * k;
          drawDot(s, x, y, Math.min((1 - s.z) * BUCKETS | 0, BUCKETS - 1));
        }
      }

      function start() { if (!raf) raf = requestAnimationFrame(frame); }
      function stop() { cancelAnimationFrame(raf); raf = 0; }

      window.addEventListener('resize', () => { resize(); init(); if (still || freeze) paintStill(); });
      document.addEventListener('visibilitychange', () => {
        // A dashboard parked in a background tab should cost nothing.
        if (document.hidden) stop(); else if (!idle) start();
      });

      resize();
      init();

      if (still || freeze) {
        // one static frame, no motion (freeze = ?freezebg=1 A/B probe)
        paintStill();
      } else {
        start();
        // Expose throttle so the UI can punch it
        window.warp = (v) => { target = Math.max(target, v); };

        // Idle pause: an ambient dashboard sits untouched for hours, but the
        // 30 fps canvas + infinite CSS animations wake the GPU compositor on
        // every refresh tick regardless of whether anyone is watching. After
        // IDLE_MS of no pointer/key/scroll input, stop the canvas loop and
        // mute ambient animation (.bg-idle CSS) so the page goes genuinely
        // still and GPU usage drops to the 1 Hz data tick. Any input event
        // resumes motion instantly.
        const IDLE_MS = 30000;
        let idleTimer = null;
        function setMotion(on) {
          idle = on;
          document.documentElement.classList.toggle('bg-idle', !on);
          if (on) start(); else stop();
        }
        function wake() {
          if (!idle) setMotion(true);
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => setMotion(false), IDLE_MS);
        }
        ['pointermove', 'pointerdown', 'wheel', 'keydown', 'scroll', 'touchstart']
          .forEach(t => window.addEventListener(t, wake, { passive: true }));
        wake();   // arm the first idle countdown
      }
    })();
