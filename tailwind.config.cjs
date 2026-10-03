const plugin = require('tailwindcss/plugin');

// Broadcast-console design tokens. Per-character colors are not static: client.ts
// rewrites --accent* on <html> whenever the selected performer changes.
const CJK = ['"HarmonyOS Sans SC"', 'MiSans', '"PingFang SC"', '"Microsoft YaHei UI"', '"Microsoft YaHei"', '"Noto Sans SC"'];

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    // Phones in landscape are the primary target, so shape queries sit beside widths.
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      short: { raw: '(max-height: 520px)' },
      tight: { raw: '(max-width: 700px)' },
      portrait: { raw: '(orientation: portrait)' },
      fine: { raw: '(hover: hover) and (pointer: fine)' },
    },
    extend: {
      colors: {
        ink: '#07080c',
        carbon: '#0c0e14',
        slate: '#151821',
        steel: '#232834',
        fog: '#8a93a6',
        bone: '#f3f1ea',
        volt: '#ffe81a',
        hot: '#ff3b3b',
        ion: '#35e1ff',
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        accent2: 'var(--accent2)',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'Bahnschrift', '"Arial Narrow"', ...CJK, 'sans-serif'],
        body: [...CJK, 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Cascadia Mono"', 'Consolas', ...CJK, 'monospace'],
      },
      letterSpacing: { tech: '.2em', wider2: '.12em' },
      cut: { xs: '.35rem', sm: '.6rem', md: '1rem', lg: '1.6rem', xl: '2.4rem' },
      backgroundImage: {
        hazard: 'repeating-linear-gradient(-45deg, #ffe81a 0 .4rem, #07080c .4rem .8rem)',
        'hazard-dark': 'repeating-linear-gradient(-45deg, rgb(7 8 12 / .92) 0 .3rem, transparent .3rem .6rem)',
        dots: 'radial-gradient(circle, rgb(255 255 255 / .3) 1px, transparent 1.5px)',
        grid: 'linear-gradient(rgb(255 255 255 / .045) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .045) 1px, transparent 1px)',
        scan: 'repeating-linear-gradient(0deg, rgb(255 255 255 / .05) 0 1px, transparent 1px 3px)',
      },
      backgroundSize: { dots: '.45rem .45rem', grid: '2.4rem 2.4rem' },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(.8rem)' }, to: { opacity: '1', transform: 'none' } },
        'slide-left': { from: { opacity: '0', transform: 'translateX(-2.4rem)' }, to: { opacity: '1', transform: 'none' } },
        'slide-right': { from: { opacity: '0', transform: 'translateX(2.4rem)' }, to: { opacity: '1', transform: 'none' } },
        blink: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '.2' } },
        march: { to: { backgroundPosition: '1.131rem 0' } },
        ping: { '0%': { transform: 'scale(.9)', opacity: '.8' }, '100%': { transform: 'scale(1.7)', opacity: '0' } },
      },
      animation: {
        rise: 'rise .5s cubic-bezier(.2,.8,.2,1) both',
        'slide-left': 'slide-left .55s cubic-bezier(.2,.8,.2,1) both',
        'slide-right': 'slide-right .55s cubic-bezier(.2,.8,.2,1) both',
        blink: 'blink 1.4s steps(2, jump-none) infinite',
        march: 'march 1s linear infinite',
        ping: 'ping 1.4s cubic-bezier(0,0,.2,1) infinite',
      },
    },
  },
  plugins: [
    plugin(({ addUtilities, matchUtilities, theme }) => {
      const sizes = theme('cut');
      // Chamfer = 45 degree corner cut. Panels cut top-left and bottom-right;
      // buttons use the opposite diagonal so the two never read as one shape.
      matchUtilities({
        cut: (value) => ({
          '--cut': value,
          'clip-path': 'polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut))',
        }),
        'cut-r': (value) => ({
          '--cut': value,
          'clip-path': 'polygon(0 0, calc(100% - var(--cut)) 0, 100% var(--cut), 100% 100%, var(--cut) 100%, 0 calc(100% - var(--cut)))',
        }),
        'cut-all': (value) => ({
          '--cut': value,
          'clip-path': 'polygon(var(--cut) 0, calc(100% - var(--cut)) 0, 100% var(--cut), 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, var(--cut) 100%, 0 calc(100% - var(--cut)), 0 var(--cut))',
        }),
        slant: (value) => ({
          '--slant': value,
          'clip-path': 'polygon(var(--slant) 0, 100% 0, calc(100% - var(--slant)) 100%, 0 100%)',
        }),
      }, { values: sizes });
      addUtilities({
        '.text-outline': {
          color: 'transparent',
          '-webkit-text-stroke': 'var(--stroke, 1px) var(--stroke-color, currentColor)',
          'paint-order': 'stroke fill',
        },
        '.no-scrollbar': { 'scrollbar-width': 'none' },
        '.no-scrollbar::-webkit-scrollbar': { display: 'none' },
        '.tabular': { 'font-variant-numeric': 'tabular-nums' },
      });
    }),
  ],
};
