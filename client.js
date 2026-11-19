window.__ModuleLoader__.load({
  id: '@local/deepseek-balance-badge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'deepseek-balance-badge';
    /**
     * Fallback click target until the Host reports its configured one. The public
     * `/console/go` plan page is not the signed-in usage view, so this stays on
     * the Console root; `consoleUrl` in the plugin config pins the workspace page.
     */
    const CONSOLE_URL = 'https://opencode.ai/console';
    /** Exact route the Host half answers; it owns the API key, the browser does not. */
    const ROUTE_PATH = '/plugin-api/opencode-go/usage';
    /** At or above this used percentage the arc and value switch to the error colour. */
    const WARN_PERCENT = 90;
    const ALERT_PERCENT = 70;
    /** Bounded retries after a failed read; a success clears them. */
    const RETRY_MS = 8_000;
    const MAX_RETRIES = 3;
    /** A quiet period after session traffic before usage is read once. */
    const SETTLE_MS = 3_000;
    const RECONNECT_MS = 1_500;
    /**
     * Keep the reading boot-fresh: mounting, returning to the foreground,
     * switching conversations, and a finished turn all read once, and this timer
     * is the safety net for usage spent from another client on the same key.
     */
    const POLL_MS = 60_000;

    /** Windows in the order the dials are laid out and the panel lists them. */
    const WINDOWS = ['rolling', 'weekly', 'monthly'];

    /** Dial geometry: a 2/3 circle whose 120° gap points straight down. */
    const GAUGE_VIEWBOX = 52;
    const GAUGE_CENTER = GAUGE_VIEWBOX / 2;
    const GAUGE_RADIUS = 21;
    const GAUGE_STROKE = 4;
    const GAUGE_START_DEG = 150;
    const GAUGE_SWEEP_DEG = 240;
    /** All three dials are the 52px gauge the single-dial version used. */
    const DIAL_SIZE = 52;

    /** The DSH send-button blue; the theme brand alias resolves near-black. */
    const BRAND_BLUE = '#4d6bfe';

    const DICTIONARIES = {
      en: {
        aria: 'OpenCode Go usage',
        title: 'OpenCode Go',
        percentUsed: '{pct}% used',
        rolling: '5-hour window',
        rollingShort: '5h',
        weekly: 'Weekly',
        weeklyShort: 'Week',
        monthly: 'Monthly',
        monthlyShort: 'Month',
        resetsIn: 'resets in {time}',
        openConsole: 'Open Console',
        unavailable: 'OpenCode Go usage is unavailable',
        unconfigured: 'OpenCode Go usage is not configured',
      },
      zh: {
        aria: 'OpenCode Go 套餐用量',
        title: 'OpenCode Go',
        percentUsed: '已用 {pct}%',
        rolling: '5 小时窗口',
        rollingShort: '5h',
        weekly: '本周',
        weeklyShort: '本周',
        monthly: '本月',
        monthlyShort: '本月',
        resetsIn: '{time}后重置',
        openConsole: '打开 Console',
        unavailable: 'OpenCode Go 用量暂不可用',
        unconfigured: '未配置 OpenCode Go 用量查询',
      },
    };

    function polar(degrees) {
      const radians = (degrees * Math.PI) / 180;
      return [
        GAUGE_CENTER + GAUGE_RADIUS * Math.cos(radians),
        GAUGE_CENTER + GAUGE_RADIUS * Math.sin(radians),
      ];
    }

    const [arcStartX, arcStartY] = polar(GAUGE_START_DEG);
    const [arcEndX, arcEndY] = polar(GAUGE_START_DEG + GAUGE_SWEEP_DEG);
    const ARC_PATH = 'M ' + arcStartX + ' ' + arcStartY
      + ' A ' + GAUGE_RADIUS + ' ' + GAUGE_RADIUS + ' 0 1 1 ' + arcEndX + ' ' + arcEndY;

    /**
     * Whole percent for the dials and rows; sub-percent usage reads as `<1` so a
     * barely used plan never looks untouched, and tenths appear below 10%.
     */
    function formatPercent(value) {
      const number = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(number)) return '—';
      const clamped = Math.max(0, Math.min(100, number));
      if (clamped > 0 && clamped < 1) return '<1';
      const rounded = Math.round(clamped * 10) / 10;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    }

    /** Compact countdown to a reset instant, in the reader's language. */
    function formatCountdown(instant, localeId) {
      if (typeof instant !== 'string' || instant === '') return '';
      const at = Date.parse(instant);
      if (!Number.isFinite(at)) return '';
      const remaining = at - Date.now();
      if (remaining <= 0) return '';
      const isChinese = String(localeId || '').toLowerCase().startsWith('zh');
      const minutes = Math.max(1, Math.round(remaining / 60_000));
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      const mins = minutes % 60;
      if (days > 0) return isChinese ? days + ' 天 ' + hours + ' 小时' : days + 'd ' + hours + 'h';
      if (hours > 0) return isChinese ? hours + ' 小时 ' + mins + ' 分' : hours + 'h ' + mins + 'm';
      return isChinese ? mins + ' 分钟' : mins + 'm';
    }

    /** State colour for a used percentage: success, warning, then error. */
    function usageColor(percent, limited) {
      if (limited || percent >= WARN_PERCENT) return 'var(--dsw-alias-state-error-primary)';
      if (percent >= ALERT_PERCENT) return 'var(--dsw-alias-state-warn-primary)';
      return 'var(--dsw-alias-state-success-primary)';
    }

    /** Centre typography by dial size: there is no line of text to spare. */
    function centreFonts(size) {
      if (size >= GAUGE_VIEWBOX) return { amount: 12, label: 9.5, lineHeight: '14px' };
      if (size >= 40) return { amount: 11, label: 9.5, lineHeight: '13px' };
      return { amount: 9.5, label: 7.5, lineHeight: '11px' };
    }

    function activeLocaleId(ctx) {
      try {
        const locale = ctx.get('locale');
        if (locale) {
          const snapshot = typeof locale.getLocale === 'function'
            ? locale.getLocale()
            : typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : undefined;
          if (snapshot !== null && typeof snapshot === 'object') {
            const id = snapshot.id || snapshot.locale || snapshot.language;
            if (typeof id === 'string' && id !== '') return id;
          }
        }
      } catch (error) {
        // A locale service that is mid-reload must not block a read.
      }
      if (typeof document !== 'undefined' && document.documentElement?.lang) {
        return document.documentElement.lang;
      }
      return 'en';
    }

    /**
     * The origin that serves this page: the HTTP listener behind the Web GUI,
     * or the desktop shell's announced Host origin for a static page. Without
     * one there is no route to read and the dials stay silent.
     */
    function hostOrigin() {
      try {
        if (typeof location !== 'undefined' && location !== null
          && (location.protocol === 'http:' || location.protocol === 'https:')) {
          return location.origin;
        }
      } catch (error) {
        // Fall through to the announced transport.
      }
      try {
        const transport = typeof window === 'undefined' ? undefined : window.__DSH_TRANSPORT__;
        if (transport !== null && typeof transport === 'object'
          && typeof transport.streamBaseUrl === 'string' && transport.streamBaseUrl !== '') {
          return new URL(transport.streamBaseUrl).origin;
        }
      } catch (error) {
        // No usable origin was announced either.
      }
      return undefined;
    }

    /** The Host answers with the configured click target; only http(s) is accepted. */
    function readConsoleUrl(body) {
      const raw = body !== null && typeof body === 'object' ? body.consoleUrl : undefined;
      if (typeof raw !== 'string' || raw === '') return undefined;
      try {
        const url = new URL(raw);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
        return url.toString();
      } catch (error) {
        return undefined;
      }
    }

    /**
     * Read the Host half. Every failure is a state, never a throw: the route
     * answers `{ ok, usage, consoleUrl }` or `{ ok: false, reason, consoleUrl }`,
     * and `no-key` means this signed-in profile has no OpenCode Go key worth a dial.
     */
    async function readUsage(force) {
      const origin = hostOrigin();
      if (origin === undefined) return { kind: 'unavailable', reason: 'no-host' };
      let response;
      try {
        response = await fetch(origin + ROUTE_PATH + (force ? '?force=1' : ''), {
          method: 'GET',
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
        });
      } catch (error) {
        return { kind: 'error', reason: 'network' };
      }
      if (!response.ok) return { kind: 'error', reason: 'http' };
      let body;
      try {
        body = await response.json();
      } catch (error) {
        return { kind: 'error', reason: 'shape' };
      }
      if (body === null || typeof body !== 'object') return { kind: 'error', reason: 'shape' };
      const consoleUrl = readConsoleUrl(body);
      if (body.ok !== true) {
        if (body.reason === 'no-key') return { kind: 'unconfigured', consoleUrl };
        return { kind: 'error', reason: typeof body.reason === 'string' ? body.reason : 'unknown', consoleUrl };
      }
      const usage = body.usage;
      if (usage === null || typeof usage !== 'object') return { kind: 'error', reason: 'shape', consoleUrl };
      return { kind: 'ready', usage, consoleUrl };
    }

    function signatureOf(state) {
      const usage = state.usage || {};
      return JSON.stringify(WINDOWS.map((key) => {
        const window = usage[key];
        return window === null || window === undefined
          ? null
          : [window.percent, window.limited === true, window.resetsAt || null];
      }));
    }

    /** Keep the last good reading through transport failures; hide when unconfigured. */
    function mergeRead(previous, next) {
      if (next.kind === 'ready') {
        const signature = signatureOf(next);
        if (previous.kind === 'ready' && previous.signature === signature) return previous;
        return { kind: 'ready', usage: next.usage, signature };
      }
      if (next.kind === 'unconfigured') return { kind: 'unconfigured' };
      if (previous.kind === 'ready') return previous;
      return { kind: next.kind };
    }

    /** The three windows in dial order, each with its display facts. */
    /** Friendly fallbacks: a missing dictionary must never leak a raw key into the UI. */
    const LABEL_FALLBACK = { rolling: '5-hour window', weekly: 'Weekly', monthly: 'Monthly' };
    const SHORT_FALLBACK = { rolling: '5h', weekly: '1w', monthly: '1m' };

    function windowRows(state, translate, localeId) {
      const rows = [];
      for (const key of WINDOWS) {
        const window = state.usage[key];
        if (window === null || window === undefined || !Number.isFinite(Number(window.percent))) continue;
        const percent = Math.max(0, Math.min(100, Number(window.percent)));
        const countdown = formatCountdown(window.resetsAt, localeId);
        rows.push({
          key,
          label: translate(key, LABEL_FALLBACK[key]),
          shortLabel: translate(key + 'Short', SHORT_FALLBACK[key]),
          percent,
          limited: window.limited === true,
          countdown,
        });
      }
      return rows;
    }

    const triggerStyle = {
      display: 'block',
      margin: 0,
      padding: 0,
      border: 'none',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      fontFamily: 'inherit',
      cursor: 'pointer',
      pointerEvents: 'auto',
      userSelect: 'none',
      outline: 'none',
      flex: 'none',
    };

    /** Keyboard focus only; a mouse click never paints a ring. */
    const focusRing = {
      outline: '2px solid ' + BRAND_BLUE,
      outlineOffset: 2,
    };

    const centerStyle = {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0,
      transform: 'translateY(-2px)',
      pointerEvents: 'none',
    };
    const centerAmountStyle = {
      fontWeight: 500,
      fontVariantNumeric: 'tabular-nums',
      color: 'var(--dsw-alias-label-primary)',
    };
    const centerLabelStyle = {
      letterSpacing: '0.01em',
      color: 'var(--dsw-alias-label-secondary)',
      whiteSpace: 'nowrap',
    };

    /**
     * Harness-style hover bubble. Both surfaces are `fixed` and positioned from
     * the dial's own rect (see `measure`), because the sidebar column clips
     * absolutely positioned children.
     */
    const tooltipStyle = {
      position: 'fixed',
      zIndex: 30,
      boxSizing: 'border-box',
      padding: '5px 9px',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 8,
      background: 'var(--dsw-alias-bg-layer-1)',
      boxShadow: '0 6px 16px rgba(0, 0, 0, 0.12)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 12,
      lineHeight: '18px',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    };

    /** The upward popover: same surface language as the Host's own small panels. */
    const panelStyle = {
      position: 'fixed',
      zIndex: 31,
      boxSizing: 'border-box',
      width: 272,
      maxWidth: 'calc(100vw - 24px)',
      padding: '12px 14px 10px',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 12,
      background: 'var(--dsw-alias-bg-layer-1)',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.14)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 12,
      lineHeight: '18px',
      textAlign: 'left',
      cursor: 'default',
    };

    const rowStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: '0 0 10px',
    };
    /** Hairline between rows, matching the Host's own grouped lists. */
    const rowSeparatorStyle = {
      borderTop: '1px solid var(--dsw-alias-border-l1)',
      paddingTop: 10,
    };
    const rowHeadStyle = {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 8,
    };
    const rowLabelStyle = {
      fontSize: 12,
      color: 'var(--dsw-alias-label-primary)',
    };
    const pillStyle = {
      padding: '0 6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 6,
      fontSize: 11,
      lineHeight: '17px',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    };
    const resetStyle = {
      fontSize: 11,
      lineHeight: '15px',
      color: 'var(--dsw-alias-label-secondary)',
      fontVariantNumeric: 'tabular-nums',
    };
    const actionStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      width: '100%',
      boxSizing: 'border-box',
      marginTop: 2,
      padding: '6px 8px',
      border: 'none',
      borderRadius: 8,
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
      fontSize: 12,
      lineHeight: '18px',
      textAlign: 'left',
      cursor: 'pointer',
    };
    const actionHoverStyle = {
      background: 'var(--dsw-alias-interactive-bg-hover)',
    };
    const barTrackStyle = {
      position: 'relative',
      height: 5,
      borderRadius: 3,
      background: 'var(--dsw-alias-border-l1)',
      overflow: 'hidden',
    };

    return {
      /** Wait for the locale service: registering dictionaries at apply time needs it mounted. */
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale');
        if (locale && typeof locale.register === 'function') {
          for (const id of Object.keys(DICTIONARIES)) {
            ctx.effect(
              () => locale.register(NS, id, DICTIONARIES[id]),
              'opencode-go-gauge: dictionary ' + id,
            );
          }
        }

        /** A missing dictionary entry must fall back to real copy, never to the key. */
        const translate = (key, fallback) => {
          const service = ctx.get('locale');
          if (service && typeof service.bind === 'function') {
            try {
              const bound = service.bind(NS);
              const text = typeof bound === 'function' ? bound(key) : undefined;
              if (typeof text === 'string' && text !== '' && text !== key) return text;
            } catch (error) {
              // Fall through to the literal copy.
            }
          }
          return fallback;
        };

        /** Pattern strings keep the placeholder visible to translators. */
        const fillPattern = (pattern, values) => {
          let text = pattern;
          for (const key of Object.keys(values)) {
            text = text.split('{' + key + '}').join(values[key]);
          }
          return text;
        };

        /** Subscribe to one forwarded Host event; a refusal degrades to the other triggers. */
        function subscribeForwarded(event, handler) {
          try {
            const remote = ctx.get('remote');
            if (!remote || typeof remote.$on !== 'function') return undefined;
            const dispose = remote.$on(event, () => handler());
            return typeof dispose === 'function' ? dispose : undefined;
          } catch (error) {
            return undefined;
          }
        }

        function GoUsageGauges(props) {
          /** The sidebar foot hands `wide`; the dials only exist while the column has width. */
          const wide = props === null || props === undefined || props.wide !== false;
          const [state, setState] = React.useState({ kind: 'idle' });
          const [open, setOpen] = React.useState(false);
          const [hoveredKey, setHoveredKey] = React.useState(undefined);
          const [focusedKey, setFocusedKey] = React.useState(undefined);
          const [actionHovered, setActionHovered] = React.useState(false);
          /** Measured from the hovered dial before paint; the column would clip an absolute child. */
          const [anchor, setAnchor] = React.useState(undefined);
          /** The Host owns this URL; the literal is only the pre-first-read default. */
          const [consoleUrl, setConsoleUrl] = React.useState(CONSOLE_URL);
          const containerRef = React.useRef(null);
          /** Remembers the column state so only a real wide↔rail change closes the popover. */
          const lastWide = React.useRef(wide);
          const [, setLocaleRevision] = React.useState(0);

          /**
           * Offsets for the tooltip and popover. Both are `fixed`, and a `fixed`
           * box is positioned against the nearest ancestor that establishes a
           * containing block (the sidebar/composer trees do this with containment
           * or a filter). Guessing that ancestor from CSS is fragile, so a
           * zero-size probe pinned to `left:0;bottom:0` measures its origin.
           */
          const measure = (node) => {
            if (node === null || node === undefined || typeof node.appendChild !== 'function') return undefined;
            let probe;
            try {
              probe = document.createElement('div');
              probe.setAttribute('aria-hidden', 'true');
              probe.style.position = 'fixed';
              probe.style.left = '0';
              probe.style.bottom = '0';
              probe.style.width = '0';
              probe.style.height = '0';
              probe.style.visibility = 'hidden';
              probe.style.pointerEvents = 'none';
              const rect = node.getBoundingClientRect();
              node.appendChild(probe);
              const origin = probe.getBoundingClientRect();
              const viewport = window.innerWidth;
              const left = Math.round(rect.left - origin.left);
              const bottom = Math.round(origin.top - rect.top + 8);
              return { left: Math.max(8, Math.min(left, viewport - 288)), bottom };
            } catch (error) {
              return undefined;
            } finally {
              if (probe !== undefined && probe.parentNode !== null && probe.parentNode !== undefined) {
                probe.parentNode.removeChild(probe);
              }
            }
          };
          const openPanel = (node) => {
            setAnchor(measure(node));
            setOpen(true);
          };
          const closePanel = () => {
            setOpen(false);
            setAnchor(undefined);
          };

          React.useEffect(() => {
            const service = ctx.get('locale');
            if (!service || typeof service.subscribe !== 'function') return undefined;
            return service.subscribe(() => setLocaleRevision((revision) => revision + 1));
          }, []);

          React.useEffect(() => {
            let live = true;
            let timer;
            let retries = 0;

            const read = () => {
              readUsage(false).then((next) => {
                if (!live) return;
                setState((previous) => mergeRead(previous, next));
                if (next.consoleUrl !== undefined) {
                  setConsoleUrl((current) => (next.consoleUrl === current ? current : next.consoleUrl));
                }
                const failed = next.kind === 'error' || next.kind === 'unavailable';
                if (failed && retries < MAX_RETRIES) {
                  retries += 1;
                  settle(RETRY_MS);
                } else if (!failed) {
                  retries = 0;
                }
              });
            };
            const settle = (delay) => {
              window.clearTimeout(timer);
              timer = window.setTimeout(read, delay);
            };
            const trigger = () => {
              retries = 0;
              settle(SETTLE_MS);
            };

            read();
            const poll = window.setInterval(() => {
              if (document.visibilityState === 'visible') settle(0);
            }, POLL_MS);
            const disposers = [
              (() => {
                const onVisibility = () => {
                  if (document.visibilityState === 'visible') trigger();
                };
                document.addEventListener('visibilitychange', onVisibility);
                return () => document.removeEventListener('visibilitychange', onVisibility);
              })(),
              ctx.on('connection/reset', () => settle(RECONNECT_MS)),
              /** A finished turn, or traffic in another conversation. */
              subscribeForwarded('api-session/activity', trigger),
              subscribeForwarded('api-session/status', trigger),
              /** A conversation became visible or left, i.e. switching conversations. */
              subscribeForwarded('api-session/added', trigger),
              subscribeForwarded('api-session/removed', trigger),
            ].filter((dispose) => typeof dispose === 'function');

            return () => {
              live = false;
              window.clearTimeout(timer);
              window.clearInterval(poll);
              for (const dispose of disposers) dispose();
            };
          }, []);

          /** Outside press, Escape, and a viewport or column change close the popover. */
          React.useEffect(() => {
            if (!open) return undefined;
            const onPointerDown = (event) => {
              const container = containerRef.current;
              if (container !== null && event.target instanceof Node && container.contains(event.target)) return;
              closePanel();
            };
            const onKeyDown = (event) => {
              if (event.key === 'Escape') closePanel();
            };
            window.addEventListener('resize', closePanel);
            document.addEventListener('mousedown', onPointerDown, true);
            document.addEventListener('keydown', onKeyDown);
            return () => {
              window.removeEventListener('resize', closePanel);
              document.removeEventListener('mousedown', onPointerDown, true);
              document.removeEventListener('keydown', onKeyDown);
            };
          }, [open]);

          /** Collapsing or expanding the column moves the dials: drop a stale popover. */
          React.useEffect(() => {
            if (lastWide.current === wide) return;
            lastWide.current = wide;
            if (open) closePanel();
          }, [wide, open]);

          if (state.kind === 'idle' || state.kind === 'unconfigured') return null;
          /** Collapsed sidebars show no dials at all: the corner fallback was removed. */
          if (!wide) return null;

          const ready = state.kind === 'ready';
          const localeId = activeLocaleId(ctx);
          const rows = ready ? windowRows(state, translate, localeId) : [];
          if (ready && rows.length === 0) return null;

          const dialSize = DIAL_SIZE;
          const fonts = centreFonts(dialSize);
          const dials = rows;

          const percentUsed = (percent) => fillPattern(translate('percentUsed', '{pct}% used'), { pct: formatPercent(percent) });
          const resetText = (row) => (row.countdown === ''
            ? ''
            : fillPattern(translate('resetsIn', 'resets in {time}'), { time: row.countdown }));
          const hoveredRow = rows.find((row) => row.key === hoveredKey);
          const tooltip = hoveredRow !== undefined
            ? hoveredRow.label + ' · ' + percentUsed(hoveredRow.percent)
            : translate('unavailable', 'OpenCode Go usage is unavailable');

          const openConsole = () => {
            try {
              window.open(consoleUrl, '_blank', 'noopener,noreferrer');
            } catch (error) {
              // A refused window must never navigate the Harness window away.
            }
            closePanel();
          };

          /**
           * Lives in the sidebar foot, so the column's own layout carries the three
           * dials when the sidebar resizes. A collapsed sidebar renders nothing:
           * there is no corner fallback any more.
           */
          return h(
            'div',
            {
              ref: containerRef,
              'data-plugin': 'opencode-go-gauge',
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 10,
                width: '100%',
                margin: '6px 0 2px',
                minWidth: 0,
              },
            },
            (open && anchor !== undefined)
              ? h('div', {
                role: 'dialog',
                'aria-label': translate('title', 'OpenCode Go'),
                style: { ...panelStyle, left: anchor.left, bottom: anchor.bottom },
              },
                rows.length === 0
                  ? h('div', { key: 'status', style: { ...resetStyle, padding: '2px 0 4px' } }, translate('unavailable', 'OpenCode Go usage is unavailable'))
                  : null,
                rows.map((row, index) => h('div', {
                  key: row.key,
                  style: index === 0 ? rowStyle : { ...rowStyle, ...rowSeparatorStyle },
                },
                  h('div', { key: 'head', style: rowHeadStyle },
                    h('span', { key: 'label', style: rowLabelStyle }, row.label),
                    h('span', {
                      key: 'pill',
                      style: { ...pillStyle, color: usageColor(row.percent, row.limited) },
                    }, percentUsed(row.percent)),
                  ),
                  h('div', { key: 'bar', style: barTrackStyle },
                    h('div', {
                      style: {
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: row.percent + '%',
                        borderRadius: 3,
                        background: usageColor(row.percent, row.limited),
                      },
                    }),
                  ),
                  resetText(row) === ''
                    ? null
                    : h('div', { key: 'reset', style: resetStyle }, resetText(row)),
                )),
                h('button', {
                  key: 'action',
                  type: 'button',
                  onClick: openConsole,
                  onPointerEnter: () => setActionHovered(true),
                  onPointerLeave: () => setActionHovered(false),
                  style: { ...actionStyle, ...(actionHovered ? actionHoverStyle : null) },
                },
                  h('span', null, translate('openConsole', 'Open Console')),
                  h('span', { 'aria-hidden': true, style: { color: 'var(--dsw-alias-label-secondary)' } }, '↗'),
                ),
              )
              : null,
            (!open && hoveredKey !== undefined && anchor !== undefined)
              ? h('div', { role: 'tooltip', style: { ...tooltipStyle, left: anchor.left, bottom: anchor.bottom } }, tooltip)
              : null,
            dials.map((row) => {
              const amountLabel = formatPercent(row.percent) + '%';
              return h('button', {
              key: 'dial-' + row.key,
              type: 'button',
              'aria-label': row.label + ': ' + percentUsed(row.percent),
              'aria-expanded': open,
              'aria-haspopup': 'dialog',
              onClick: (event) => (open ? closePanel() : openPanel(event.currentTarget)),
              onPointerEnter: (event) => {
                setAnchor(measure(event.currentTarget));
                setHoveredKey(row.key);
              },
              onPointerLeave: () => setHoveredKey(undefined),
              onFocus: (event) => {
                let visible = true;
                try {
                  visible = event.currentTarget.matches(':focus-visible');
                } catch (error) {
                  // Older engines cannot answer; treat it as keyboard focus.
                }
                setFocusedKey(visible ? row.key : undefined);
                if (visible) setAnchor(measure(event.currentTarget));
              },
              onBlur: () => setFocusedKey(undefined),
              style: {
                ...triggerStyle,
                position: 'relative',
                width: dialSize,
                height: dialSize,
                borderRadius: dialSize / 2,
                ...(focusedKey === row.key ? focusRing : null),
              },
            },
              h('svg', {
                key: 'gauge',
                width: dialSize,
                height: dialSize,
                viewBox: '0 0 ' + GAUGE_VIEWBOX + ' ' + GAUGE_VIEWBOX,
                'aria-hidden': true,
                style: { display: 'block' },
              },
                h('path', {
                  key: 'track',
                  d: ARC_PATH,
                  fill: 'none',
                  stroke: 'var(--dsw-alias-border-l1)',
                  strokeWidth: GAUGE_STROKE,
                  strokeLinecap: 'round',
                }),
                row.percent <= 0 ? null : h('path', {
                  key: 'progress',
                  d: ARC_PATH,
                  fill: 'none',
                  stroke: usageColor(row.percent, row.limited),
                  strokeWidth: GAUGE_STROKE,
                  strokeLinecap: 'round',
                  pathLength: 100,
                  strokeDasharray: row.percent + ' 100',
                  style: { transition: 'stroke-dasharray 240ms ease, stroke 160ms ease' },
                }),
              ),
              h('span', { key: 'center', style: centerStyle },
                h('span', {
                  key: 'amount',
                  style: {
                    ...centerAmountStyle,
                    /** '100%' is the only reading that reaches the arc: give it a step down. */
                    fontSize: amountLabel.length >= 4 ? fonts.amount - 1.5 : fonts.amount,
                    lineHeight: fonts.lineHeight,
                    ...(row.limited || row.percent >= WARN_PERCENT ? { color: 'var(--dsw-alias-state-error-primary)' } : null),
                  },
                }, amountLabel),
                h('span', { key: 'label', style: { ...centerLabelStyle, fontSize: row.key === 'rolling' ? fonts.label + 1 : fonts.label } }, row.shortLabel),
              ),
              );
            }),
          );
        }

        /**
         * One seat, three dials. The sidebar foot is the only home: collapsing the
         * sidebar hides them, which is the requested behaviour.
         */
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'opencode-go-gauge',
          order: 20,
          label: () => translate('aria', 'OpenCode Go usage'),
        }, (props) => h(GoUsageGauges, {
          wide: props === null || props === undefined ? undefined : props.wide,
        })));
      },
    };
  },
});
