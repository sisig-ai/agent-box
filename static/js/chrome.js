// Page chrome: host name, site title, system count, greeting and the clock.
// Registered before Alpine.start so the header is live on every view; the
// stack grid reads the same config promise. The clock opens the theme
// picker, which lives on the dialog as its own component (theme.js).

import { loadConfig } from './config.js';

function greeting(hour) {
  if (hour < 5) return 'deep in the night watch';
  if (hour < 12) return 'good morning';
  if (hour < 18) return 'good afternoon';
  return 'good evening';
}

export function chrome() {
  return {
    host: window.location.hostname || 'localhost',
    title: 'macmini',
    greeting: 'all systems standing by.',
    count: 'loading…',
    time: '--:--',
    date: '',
    tz: '',
    timer: 0,

    init() {
      this.tick();
      this.timer = setInterval(() => this.tick(), 15000);
      loadConfig()
        .then((config) => {
          if (config.title) {
            this.title = config.title;
            document.title = config.title;
          }
          const services = config.services || [];
          this.count = `${services.length} system${services.length === 1 ? '' : 's'} nominal`;
          this.greeting = `${greeting(new Date().getHours())} · all systems standing by.`;
        })
        .catch(() => { this.count = 'signal lost'; });
    },

    destroy() {
      clearInterval(this.timer);
    },

    tick() {
      const now = new Date();
      this.time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      this.date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      this.tz = now.toLocaleTimeString([], { timeZoneName: 'short' }).split(' ').pop();
    },
  };
}


