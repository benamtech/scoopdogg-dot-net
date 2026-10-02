/** @type {import('tailwindcss').Config} */
//
// THE SCOOP DOGG BRAND SYSTEM - the one place a colour, a size or a radius is decided.
//
// Evolved 2026-09-16 (Ben: "evolve it" - keep the name, the mascot, forest green and amber;
// rebuild the system around them). Before this file the homepage used 18 distinct font sizes
// and 26 text colours (measured: research/corpus/baseline/pre-elevation-2026-09-16). A
// professional system uses few of each, on purpose, and gates/brand-tokens.mjs holds the
// line: no raw hex and no arbitrary font size in src/ outside this file.
//
// Legacy names (forest, forest-dark, sage, sage-light, amber, amber-hover, cream, dark) are
// kept as aliases so the admin screens keep rendering while they move onto the scales.
//
// Design pass 2 (Ben, 2026-09-16): "white-text-on-green ... white-text on orange ... others may
// use a combination of all three (the third being our default black text on white which
// dominates the site)". So there are three SURFACES, and a band declares one with
// <Section tone="white|forest|orange">. Text colours inside a band come from the `tone-*`
// colours below, which read CSS variables the band sets (src/index.css), so a heading, a link
// or an eyebrow is right on any surface without a `dark` prop. Every pairing is a number in
// tests/contrast.test.ts. The rule the numbers force: white on orange is 3.15:1, so on an
// orange band only LARGE text is white (text-h*, text-statement); anything smaller sits on a
// white card inside the band.
export default {
  content: ['./src/**/*.{astro,js,ts,jsx,tsx,md,mdx}'],
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      nav: '1020px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // Brand green, from the logo and Josue's own polo.
        forest: {
          DEFAULT: '#1B4332',
          950: '#0B1F16',
          900: '#0F2A1F',
          800: '#143728',
          700: '#1B4332',
          600: '#24593F',
          500: '#2D6A4F',
          400: '#52876C',
          300: '#95B8A2',
          200: '#C9DDD0',
          100: '#E8F0EB',
          50: '#F3F7F4',
          dark: '#143728',
        },
        // The call to action. Always with forest-900 text: white on amber is 2.1:1.
        amber: {
          DEFAULT: '#F4A024',
          // Amber text on amber-100 needs 4.5:1; #B36B00 measured 3.71 (Lighthouse, 2026-09-16).
          700: '#8A5200',
          600: '#E08A0B',
          500: '#F4A024',
          400: '#F7B650',
          200: '#FBDDA8',
          100: '#FDF0DA',
          hover: '#E8911A',
        },
        // The band orange. Deepened from amber because white on amber is 2.12:1 (the old site's
        // service-area band). #DD7607 is the deepest orange that still reads as the brand when
        // rendered beside the emblem; #B85C00 and darker carry small white text but read brown.
        orange: {
          DEFAULT: '#DD7607',
          600: '#DD7607',
          700: '#B85C00',
          100: '#FDEBD3',
          50: '#FFF7ED',
        },
        // What text inside a band uses. Values are set per surface in src/index.css.
        tone: {
          bg: 'rgb(var(--tone-bg) / <alpha-value>)',
          fg: 'rgb(var(--tone-fg) / <alpha-value>)',
          heading: 'rgb(var(--tone-heading) / <alpha-value>)',
          muted: 'rgb(var(--tone-muted) / <alpha-value>)',
          accent: 'rgb(var(--tone-accent) / <alpha-value>)',
          rule: 'rgb(var(--tone-rule) / <alpha-value>)',
        },
        cream: '#FAF8F5',
        sand: '#F2EDE4',
        paper: '#FFFFFF',
        ink: {
          DEFAULT: '#1A1A1A',
          900: '#1A1A1A',
          700: '#3A423E',
          500: '#5B6660',
          // 4.9:1 on white, so small secondary text passes WCAG AA (was #7C8781, 3.9:1).
          400: '#687169',
        },
        // Cooler than before: the page is white now, not cream, and a warm grey rule on white
        // reads as dirt.
        line: { DEFAULT: '#E3E8E4', strong: '#CBD4CE' },
        sage: { DEFAULT: '#95B8A2', light: '#E8F0EB' },
        dark: '#1A1A1A',
        danger: { DEFAULT: '#B42318', 100: '#FDECEA' },
        success: { DEFAULT: '#1F7A4D', 100: '#E6F4EC' },
        info: { DEFAULT: '#1D4E89', 100: '#E8F0FA' },
      },
      fontFamily: {
        serif: ['"DM Serif Display"', 'Georgia', 'serif'],
        sans: ['"Outfit Variable"', 'Outfit', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      // Ten sizes. Display sizes are fluid, so a heading is proportionate at 390px and at
      // 1440px without a breakpoint per page.
      fontSize: {
        micro: ['0.75rem', { lineHeight: '1.1rem', letterSpacing: '0.12em' }],
        sm: ['0.875rem', { lineHeight: '1.35rem' }],
        base: ['1rem', { lineHeight: '1.65rem' }],
        lg: ['1.1875rem', { lineHeight: '1.8rem' }],
        xl: ['1.375rem', { lineHeight: '1.9rem' }],
        // Never below 24px, so it is WCAG "large text" at every width: the size that may be
        // white on the orange band.
        statement: ['clamp(1.5rem, 1.25rem + 0.8vw, 1.875rem)', { lineHeight: '1.3' }],
        h3: ['clamp(1.375rem, 1.1rem + 0.9vw, 1.75rem)', { lineHeight: '1.2' }],
        h2: ['clamp(1.875rem, 1.3rem + 2vw, 2.875rem)', { lineHeight: '1.08', letterSpacing: '-0.01em' }],
        h1: ['clamp(2.375rem, 1.5rem + 3.4vw, 4.25rem)', { lineHeight: '1.02', letterSpacing: '-0.015em' }],
        hero: ['clamp(2.625rem, 1.4rem + 4.6vw, 5.25rem)', { lineHeight: '0.98', letterSpacing: '-0.02em' }],
        // The wordmark only. Not for headings.
        logo: ['1.625rem', { lineHeight: '1' }],
        'logo-lg': ['2.125rem', { lineHeight: '1' }],
      },
      maxWidth: {
        site: '1200px',
        prose: '68ch',
        narrow: '760px',
      },
      spacing: {
        section: 'clamp(4rem, 2.5rem + 5vw, 7.5rem)',
        'section-sm': 'clamp(3rem, 2rem + 3vw, 5rem)',
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '10px',
        md: '12px',
        lg: '18px',
        xl: '24px',
        card: '18px',
      },
      boxShadow: {
        xs: '0 1px 2px rgba(15, 42, 31, 0.06)',
        sm: '0 1px 3px rgba(15, 42, 31, 0.06), 0 2px 8px rgba(15, 42, 31, 0.05)',
        md: '0 2px 6px rgba(15, 42, 31, 0.06), 0 12px 28px rgba(15, 42, 31, 0.08)',
        lg: '0 4px 12px rgba(15, 42, 31, 0.08), 0 24px 56px rgba(15, 42, 31, 0.14)',
        card: '0 1px 3px rgba(15, 42, 31, 0.06), 0 2px 8px rgba(15, 42, 31, 0.05)',
        'card-hover': '0 2px 6px rgba(15, 42, 31, 0.06), 0 12px 28px rgba(15, 42, 31, 0.08)',
        nav: '0 1px 0 rgba(15, 42, 31, 0.06)',
        focus: '0 0 0 3px rgba(244, 160, 36, 0.55)',
      },
      transitionTimingFunction: {
        brand: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      transitionDuration: {
        fast: '150ms',
        base: '250ms',
        slow: '400ms',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 400ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'scale-in': 'scale-in 250ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'slide-in-right': 'slide-in-right 250ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'slide-in-left': 'slide-in-left 250ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
      },
    },
  },
  plugins: [],
};
