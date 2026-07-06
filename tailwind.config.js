/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
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
        forest: '#1B4332',
        'forest-dark': '#143728',
        sage: '#95B8A2',
        'sage-light': '#E8F0EB',
        amber: '#F4A024',
        'amber-hover': '#E8911A',
        cream: '#FAF8F5',
        dark: '#1A1A1A',
      },
      fontFamily: {
        serif: ['"DM Serif Display"', 'Georgia', 'serif'],
        sans: ['Outfit', 'system-ui', 'sans-serif'],
      },
      maxWidth: {
        site: '1200px',
      },
      borderRadius: {
        card: '16px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.07)',
        'card-hover': '0 2px 6px rgba(0,0,0,0.06), 0 12px 36px rgba(0,0,0,0.12)',
        nav: '0 1px 0 rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.08)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(40px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-40px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'draw-check': {
          '0%': { strokeDashoffset: '100' },
          '100%': { strokeDashoffset: '0' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.8)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.6s ease forwards',
        'slide-in-right': 'slide-in-right 0.35s ease forwards',
        'slide-in-left': 'slide-in-left 0.35s ease forwards',
        'scale-in': 'scale-in 0.4s ease forwards',
      },
    },
  },
  plugins: [],
};
