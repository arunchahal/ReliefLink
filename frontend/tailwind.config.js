/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'sos-red': '#ef4444',
        'safe-green': '#22c55e',
        'progress-yellow': '#eab308',
        'ui-blue': '#3b82f6',
      }
    },
  },
  plugins: [],
}
