/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          25:  '#fff4eb',
          50:  '#ffebdb',
          100: '#ffe3cc',
          200: '#ffcda3',
          300: '#ffab66',
          400: '#f26d00',
          500: '#d66000',
          600: '#c25700',
          700: '#994500',
          800: '#853c00',
          900: '#703300',
          950: '#522500',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        xs: '0 1px 2px rgba(10,13,18,0.05)',
        sm: '0 1px 2px rgba(10,13,18,0.10), 0 1px 3px rgba(10,13,18,0.10)',
      },
    },
  },
  plugins: [],
};
